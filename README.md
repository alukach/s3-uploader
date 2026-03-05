# S3 Uploader (GitHub Pages)

Static browser UI for one-off bulk uploads to an S3 bucket via simple PUT requests.

## Features

- Drag-and-drop file selection
- Simple PUT uploads (anonymous-compatible, no auth required)
- Multiple files uploaded in parallel
- Per-file and overall progress bars
- Bucket, region, and prefix configurable via query parameters
- No backend required (works from GitHub Pages)

## Files

- `index.html`
- `styles.css`
- `app.js`

## Deploy to GitHub Pages

1. Push these files to a GitHub repository.
2. In GitHub repo settings, enable Pages from your preferred branch/folder.
3. Open the Pages URL and run uploads from there.

## Required S3 setup (public write for one-off use)

This app sends unsigned browser requests directly to S3. The bucket policy must temporarily allow anonymous PUT uploads.

### Example bucket policy (temporary)

Replace `YOUR_BUCKET_NAME`.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "TemporaryAnonymousWrite",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
    }
  ]
}
```

### Example CORS configuration

Replace `https://<your-user>.github.io` with your GitHub Pages origin.

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "POST", "PUT", "DELETE", "HEAD"],
    "AllowedOrigins": ["https://<your-user>.github.io"],
    "ExposeHeaders": ["ETag", "x-amz-request-id", "x-amz-id-2"],
    "MaxAgeSeconds": 3000
  }
]
```

## Usage

1. Enter bucket, region, optional key prefix.
2. Drag files onto the drop zone.
3. Click **Start Upload**.
4. Monitor per-file and overall progress bars.
5. After upload is complete, make the bucket private again.

### Query parameters

Bucket, prefix, and region can be pre-filled via URL query parameters:

```
https://<your-user>.github.io/s3-uploader/?bucket=my-bucket&prefix=uploads&region=us-west-2
```

## Notes

- Simple PUT uploads have a **5 GB file size limit** (S3 hard limit).
- If your bucket name contains dots and TLS/endpoint issues occur, enable path-style mode in the UI.
- This is intentionally for temporary, one-off uploads. Do not leave anonymous write policies enabled.
