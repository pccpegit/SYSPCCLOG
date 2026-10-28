FROM python:3.12-slim

# System dependencies
# libmagic1 is required by python-magic for file type detection
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 \
    && rm -rf /var/lib/apt/lists/*

# SYSPCC-022: optional LibreOffice (headless) to convert generated .docx to PDF.
# Off by default (keeps the image small for Render free tier); docker-compose
# local turns it on via build.args. Without it the API answers `pdf_not_available`.
ARG INSTALL_LIBREOFFICE=false
RUN if [ "$INSTALL_LIBREOFFICE" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends \
        libreoffice-writer fonts-liberation fonts-crosextra-carlito \
      && rm -rf /var/lib/apt/lists/*; \
    fi

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]
