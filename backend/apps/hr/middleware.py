class HRNoStoreMiddleware:
    """`Cache-Control: no-store` on every /api/v1/hr/* response (PII: contracts,
    DNI, salaries). Scoped to the module prefix so the rest of the API is unchanged."""

    PREFIX = '/api/v1/hr/'

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.path.startswith(self.PREFIX):
            response['Cache-Control'] = 'no-store'
        return response
