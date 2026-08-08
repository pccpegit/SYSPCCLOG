"""
Signature image processing service.
Cleans uploaded signature photos: removes background, converts to transparent PNG.
Uses adaptive thresholding for better results with camera photos.
"""
import io
import base64
import statistics

from PIL import Image, ImageFilter, ImageOps, ImageEnhance


def process_signature_image(image_file) -> io.BytesIO:
    """
    Process an uploaded signature image (photo from camera).
    1. Auto-rotate based on EXIF
    2. Convert to grayscale
    3. Normalize lighting (auto-contrast)
    4. Adaptive threshold to separate ink from background
    5. Remove background (make transparent)
    6. Crop to signature bounds
    7. Normalize size

    Accepts: file-like object (UploadedFile) or bytes
    Returns: BytesIO with PNG data
    """
    img = Image.open(image_file)

    # Auto-rotate based on EXIF (camera photos are often rotated)
    img = ImageOps.exif_transpose(img)

    # Resize if too large (max 1500px on longest side)
    max_side = 1500
    if max(img.size) > max_side:
        img.thumbnail((max_side, max_side), Image.LANCZOS)

    # Convert to grayscale
    gray = img.convert('L')

    # Auto-contrast to normalize lighting differences
    gray = ImageOps.autocontrast(gray, cutoff=1)

    # Enhance contrast more aggressively
    gray = ImageEnhance.Contrast(gray).enhance(2.0)

    # Slight blur to reduce camera noise
    gray = gray.filter(ImageFilter.GaussianBlur(radius=0.8))

    # Calculate adaptive threshold using Otsu's method
    threshold = _otsu_threshold(gray)
    # Bias toward keeping more ink (lower threshold removes more background)
    threshold = min(threshold + 20, 240)

    # Create RGBA output
    w, h = gray.size
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    gray_px = gray.load()
    out_px = out.load()

    for y in range(h):
        for x in range(w):
            val = gray_px[x, y]
            if val > threshold:
                # Background → transparent
                out_px[x, y] = (0, 0, 0, 0)
            else:
                # Ink → black with opacity proportional to darkness
                alpha = int((1.0 - val / threshold) * 255)
                alpha = min(255, int(alpha * 1.8))  # boost
                out_px[x, y] = (0, 0, 0, max(alpha, 80))

    # Remove small noise spots (erode then dilate conceptually - just remove tiny islands)
    out = _remove_noise(out, min_size=15)

    # Crop to bounding box
    bbox = out.getbbox()
    if bbox:
        pad = 15
        left = max(0, bbox[0] - pad)
        top = max(0, bbox[1] - pad)
        right = min(w, bbox[2] + pad)
        bottom = min(h, bbox[3] + pad)
        out = out.crop((left, top, right, bottom))

    # Normalize to standard height (120px for good PDF quality)
    target_height = 120
    if out.height > 0 and out.width > 0:
        ratio = target_height / out.height
        new_width = max(1, int(out.width * ratio))
        out = out.resize((new_width, target_height), Image.LANCZOS)

    output = io.BytesIO()
    out.save(output, format='PNG', optimize=True)
    output.seek(0)
    return output


def process_base64_signature(data_uri: str) -> io.BytesIO:
    """
    Process a base64-encoded signature from a canvas drawing.
    Input format: "data:image/png;base64,iVBOR..."
    Returns: BytesIO with cleaned PNG data
    """
    if ',' in data_uri:
        data_uri = data_uri.split(',', 1)[1]

    image_data = base64.b64decode(data_uri)
    img = Image.open(io.BytesIO(image_data)).convert('RGBA')

    # For drawn signatures: clean up white bg, normalize ink to black
    pixels = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = pixels[x, y]
            if a < 10 or (r > 230 and g > 230 and b > 230):
                pixels[x, y] = (0, 0, 0, 0)
            elif a > 0:
                pixels[x, y] = (0, 0, 0, a)

    # Crop
    bbox = img.getbbox()
    if bbox:
        pad = 15
        left = max(0, bbox[0] - pad)
        top = max(0, bbox[1] - pad)
        right = min(img.width, bbox[2] + pad)
        bottom = min(img.height, bbox[3] + pad)
        img = img.crop((left, top, right, bottom))

    # Normalize height
    target_height = 120
    if img.height > 0 and img.width > 0:
        ratio = target_height / img.height
        new_width = max(1, int(img.width * ratio))
        img = img.resize((new_width, target_height), Image.LANCZOS)

    output = io.BytesIO()
    img.save(output, format='PNG', optimize=True)
    output.seek(0)
    return output


def _otsu_threshold(gray_img):
    """
    Calculate optimal threshold using Otsu's method.
    Finds the threshold that minimizes intra-class variance between
    foreground (ink) and background (paper).
    """
    hist = gray_img.histogram()
    total = sum(hist)
    if total == 0:
        return 128

    sum_all = sum(i * hist[i] for i in range(256))

    sum_bg = 0
    weight_bg = 0
    max_variance = 0
    best_threshold = 128

    for t in range(256):
        weight_bg += hist[t]
        if weight_bg == 0:
            continue
        weight_fg = total - weight_bg
        if weight_fg == 0:
            break

        sum_bg += t * hist[t]
        mean_bg = sum_bg / weight_bg
        mean_fg = (sum_all - sum_bg) / weight_fg

        variance = weight_bg * weight_fg * (mean_bg - mean_fg) ** 2
        if variance > max_variance:
            max_variance = variance
            best_threshold = t

    return best_threshold


def _remove_noise(rgba_img, min_size=15):
    """
    Remove tiny isolated pixel clusters (noise from camera).
    Simple flood-fill approach on non-transparent pixels.
    """
    # Skip if image is small (already clean, drawn signature)
    if rgba_img.width * rgba_img.height < 50000:
        return rgba_img

    pixels = rgba_img.load()
    w, h = rgba_img.size
    visited = set()

    def flood_fill(sx, sy):
        """Return set of connected non-transparent pixel coords."""
        stack = [(sx, sy)]
        cluster = set()
        while stack:
            cx, cy = stack.pop()
            if (cx, cy) in visited or cx < 0 or cy < 0 or cx >= w or cy >= h:
                continue
            if pixels[cx, cy][3] < 50:
                continue
            visited.add((cx, cy))
            cluster.add((cx, cy))
            if len(cluster) > min_size:
                return cluster  # Big enough, stop early
            stack.extend([(cx+1, cy), (cx-1, cy), (cx, cy+1), (cx, cy-1)])
        return cluster

    # Find and remove small clusters
    for y in range(h):
        for x in range(w):
            if (x, y) in visited or pixels[x, y][3] < 50:
                continue
            cluster = flood_fill(x, y)
            if len(cluster) <= min_size:
                for px, py in cluster:
                    pixels[px, py] = (0, 0, 0, 0)

    return rgba_img
