"""
Object Storage (S3/R2) — Upload et download de fichiers.

Remplace le stockage BYTEA dans PostgreSQL pour les pieces jointes,
photos de pointage, documents SEAOP, etc.

Usage:
    from infrastructure.storage import upload_file, get_file_url, delete_file

    # Upload
    key = await upload_file(file_data, "pointage/photos/2026-04-11_bt123.jpg", "image/jpeg")

    # URL pre-signee (lecture 1h)
    url = get_file_url(key)

    # Suppression
    delete_file(key)

Configuration:
    S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY env vars.
    S3_ENDPOINT pour Cloudflare R2 ou MinIO.
    Si absent, les fonctions retournent None (fallback BD existant).
"""

import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

S3_BUCKET = os.getenv("S3_BUCKET")
S3_REGION = os.getenv("S3_REGION", "auto")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY")
S3_ENDPOINT = os.getenv("S3_ENDPOINT")  # Pour Cloudflare R2

_s3_client = None
_s3_available = None


def _get_s3():
    """Get S3/R2 client. Returns None if not configured."""
    global _s3_client, _s3_available

    if _s3_available is False:
        return None

    if _s3_client is not None:
        return _s3_client

    if not all([S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY]):
        _s3_available = False
        logger.info("S3/R2 not configured — using PostgreSQL BYTEA fallback")
        return None

    try:
        import boto3
        kwargs = {
            "service_name": "s3",
            "aws_access_key_id": S3_ACCESS_KEY,
            "aws_secret_access_key": S3_SECRET_KEY,
            "region_name": S3_REGION,
        }
        if S3_ENDPOINT:
            kwargs["endpoint_url"] = S3_ENDPOINT
        _s3_client = boto3.client(**kwargs)
        _s3_available = True
        logger.info("S3/R2 connected: bucket=%s", S3_BUCKET)
        return _s3_client
    except Exception as exc:
        _s3_available = False
        logger.warning("S3/R2 unavailable: %s", exc)
        return None


def is_available() -> bool:
    """Check if S3/R2 storage is available."""
    return _get_s3() is not None


def upload_file(file_data: bytes, key: str, content_type: str = "application/octet-stream") -> Optional[str]:
    """Upload file to S3/R2. Returns the key on success, None if unavailable."""
    client = _get_s3()
    if not client:
        return None
    try:
        client.put_object(
            Bucket=S3_BUCKET,
            Key=key,
            Body=file_data,
            ContentType=content_type,
        )
        logger.info("Uploaded %s (%d bytes)", key, len(file_data))
        return key
    except Exception as exc:
        logger.error("S3 upload failed for %s: %s", key, exc)
        return None


def get_file_url(key: str, expires_in: int = 3600) -> Optional[str]:
    """Generate a pre-signed URL for file download. Returns None if unavailable."""
    client = _get_s3()
    if not client:
        return None
    try:
        url = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": S3_BUCKET, "Key": key},
            ExpiresIn=expires_in,
        )
        return url
    except Exception as exc:
        logger.error("S3 presigned URL failed for %s: %s", key, exc)
        return None


def delete_file(key: str) -> bool:
    """Delete a file from S3/R2. Returns True on success."""
    client = _get_s3()
    if not client:
        return False
    try:
        client.delete_object(Bucket=S3_BUCKET, Key=key)
        return True
    except Exception as exc:
        logger.error("S3 delete failed for %s: %s", key, exc)
        return False
