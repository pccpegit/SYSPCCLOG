"""Claude client for CV analysis (SYSPCC-023). Only this module talks to the SDK.

Verified against anthropic==1.11.0: `client.messages.parse(model, max_tokens,
system, messages, output_config={'effort': ...}, output_format=PydanticModel)`
-> `.parsed_output`, `.usage`, `.stop_reason`. Content blocks: `document`
(base64 pdf), `image` (base64), `text`.

Errors are translated into two domain exceptions so the pipeline decides
retry vs. fail without knowing the SDK:
  AgentTransient(code, retry_after)  -> retry with backoff
  AgentPermanent(code)               -> fail the item, no retry
Exception TEXT is never logged or stored: SDK/pydantic messages can echo CV
content (PII).

Iteration 2: besides CVs it reads job postings (`extract_posting`) and hosts the
simulated provider hook (`HR_CV_PROVIDER=fake`, DEBUG only; see cv_fake.py).
"""

import logging
from dataclasses import dataclass

import anthropic
import pydantic
from django.conf import settings

from apps.hr.services import cv_fake
from apps.hr.services.cv_posting_heuristics import RawPosting
from apps.hr.services.cv_prompts import POSTING_SYSTEM_PROMPT, SYSTEM_PROMPT
from apps.hr.services.cv_schemas import PostingExtraction, report_model

logger = logging.getLogger(__name__)
FALLBACK_BETA = 'server-side-fallback-2026-07-01'
FAKE_MODEL_LABEL = 'simulado'


class AgentError(Exception):
    def __init__(self, code: str, usage: tuple[int, int] = (0, 0)):
        super().__init__(code)
        self.code, self.usage = code, usage


class AgentTransient(AgentError):
    def __init__(self, code: str, retry_after: float | None = None, max_attempts: int | None = None,
                 usage: tuple[int, int] = (0, 0)):
        super().__init__(code, usage)
        self.retry_after, self.max_attempts = retry_after, max_attempts


class AgentPermanent(AgentError):
    pass


@dataclass
class AgentResult:
    report: object  # parsed pydantic model
    tokens_in: int
    tokens_out: int
    model: str = ''
    simulated: bool = False


@dataclass
class PostingAgentResult:
    proposal: RawPosting
    tokens_in: int
    tokens_out: int


_fake_denied_logged = False


def provider_name() -> str:
    """'fake' only when HR_CV_PROVIDER=fake AND DEBUG. Fail-closed: if fake is
    requested outside DEBUG (settings guards should already have refused to
    boot) the real provider is used and an ERROR is logged once."""
    global _fake_denied_logged
    if getattr(settings, 'HR_CV_PROVIDER', 'anthropic') == 'fake':
        if settings.DEBUG:
            return 'fake'
        if not _fake_denied_logged:
            _fake_denied_logged = True
            logger.error('hr.cv provider=fake ignorado: solo se permite con DEBUG=True')
    return 'anthropic'


def is_enabled() -> bool:
    return provider_name() == 'fake' or bool(settings.ANTHROPIC_API_KEY)


def has_api_key() -> bool:
    return bool(settings.ANTHROPIC_API_KEY)


def model_label() -> str:
    return FAKE_MODEL_LABEL if provider_name() == 'fake' else settings.HR_CV_MODEL


def _retry_after(exc) -> float | None:
    try:
        raw = exc.response.headers.get('retry-after')
        return min(float(raw), 600.0) if raw else None
    except Exception:  # noqa: BLE001 - header is optional/untrusted
        return None


class CVAgent:
    def __init__(self, client=None):
        self._client = client

    @property
    def client(self):
        if self._client is None:
            self._client = anthropic.Anthropic(
                api_key=settings.ANTHROPIC_API_KEY, timeout=settings.HR_CV_TIMEOUT, max_retries=1,
            )
        return self._client

    def _call(self, kwargs: dict, *, fallback: bool = False):
        """One SDK call with the exception translation shared by every use.
        Returns (parsed, (tokens_in, tokens_out))."""
        try:
            if fallback and settings.HR_CV_SERVER_FALLBACK:
                response = self.client.beta.messages.parse(betas=[FALLBACK_BETA], fallbacks='default', **kwargs)
            else:
                response = self.client.messages.parse(**kwargs)
        except anthropic.RateLimitError as exc:
            raise AgentTransient('ai_rate_limited', retry_after=_retry_after(exc))
        except anthropic.APIConnectionError:  # includes APITimeoutError
            raise AgentTransient('ai_failed')
        except anthropic.APIStatusError as exc:
            status = getattr(exc, 'status_code', 0) or 0
            if status in (401, 403):
                raise AgentPermanent('ai_unavailable')
            if status in (400, 413, 422):
                raise AgentPermanent('cv_rejected_by_ai')
            if status >= 500 or status in (408, 409, 529):
                raise AgentTransient('ai_failed', retry_after=_retry_after(exc))
            raise AgentPermanent('ai_failed')
        except pydantic.ValidationError:
            raise AgentTransient('ai_unparseable', max_attempts=2)
        except anthropic.AnthropicError:
            raise AgentPermanent('ai_failed')

        usage = getattr(response, 'usage', None)
        tokens = (int(getattr(usage, 'input_tokens', 0) or 0), int(getattr(usage, 'output_tokens', 0) or 0))
        stop = getattr(response, 'stop_reason', None)
        if stop == 'refusal':
            raise AgentPermanent('ai_refusal', usage=tokens)
        parsed = getattr(response, 'parsed_output', None)
        if stop == 'max_tokens' or parsed is None:
            raise AgentTransient('ai_unparseable', max_attempts=2, usage=tokens)
        return parsed, tokens

    def analyze(self, content_blocks: list, has_requirements: bool, *, seed=None,
                requirements: list[dict] | None = None) -> AgentResult:
        if provider_name() == 'fake':
            # No SDK, no network: deterministic report from the file hash.
            cv_fake.simulate_delay(seed)
            if cv_fake.should_fail(seed):
                raise AgentPermanent('ai_failed')
            report = cv_fake.fake_report(seed, has_requirements, requirements)
            return AgentResult(report=report, tokens_in=0, tokens_out=0, model=FAKE_MODEL_LABEL, simulated=True)
        kwargs = {
            'model': settings.HR_CV_MODEL,
            'max_tokens': settings.HR_CV_MAX_TOKENS,
            'output_config': {'effort': settings.HR_CV_EFFORT},
            'system': SYSTEM_PROMPT,
            'messages': [{'role': 'user', 'content': content_blocks}],
            'output_format': report_model(has_requirements),
        }
        parsed, tokens = self._call(kwargs, fallback=True)
        return AgentResult(report=parsed, tokens_in=tokens[0], tokens_out=tokens[1], model=settings.HR_CV_MODEL)

    def extract_posting(self, content_blocks: list) -> PostingAgentResult:
        """Read a job posting. Synchronous (inside the HTTP request): short timeout,
        no own retries (the SDK already does max_retries=1)."""
        kwargs = {
            'model': settings.HR_CV_POSTING_MODEL or settings.HR_CV_MODEL,
            'max_tokens': settings.HR_CV_POSTING_MAX_TOKENS,
            'output_config': {'effort': settings.HR_CV_POSTING_EFFORT},
            'system': POSTING_SYSTEM_PROMPT,
            'messages': [{'role': 'user', 'content': content_blocks}],
            'output_format': PostingExtraction,
            'timeout': settings.HR_CV_POSTING_TIMEOUT,
        }
        parsed, tokens = self._call(kwargs)
        proposal = RawPosting(
            position_title=parsed.position_title or None,
            requirements=[(r.text, 3 if r.mandatory else 1) for r in parsed.requirements],
            omitted_protected=bool(parsed.omitted_protected),
        )
        return PostingAgentResult(proposal=proposal, tokens_in=tokens[0], tokens_out=tokens[1])
