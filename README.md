# S3 Multipart Uploader (GitHub Pages)

Static browser UI for one-off bulk uploads to an S3 bucket using multipart uploads with concurrent part workers.

## Features

- Drag-and-drop file selection
- Multipart uploads (`CreateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload`)
- Configurable part size and concurrency
- Multiple files uploaded in parallel
- Per-file and overall progress bars
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

This app sends unsigned browser requests directly to S3. The bucket policy must temporarily allow multipart upload actions from anonymous users.

### Example bucket policy (temporary)

Replace `YOUR_BUCKET_NAME`.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "TemporaryAnonymousMultipartWrite",
      "Effect": "Allow",
      "Principal": "*",
      "Action": [
        "s3:PutObject",
        "s3:AbortMultipartUpload"
      ],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
    },
    {
      "Sid": "TemporaryAnonymousListMultipart",
      "Effect": "Allow",
      "Principal": "*",
      "Action": [
        "s3:ListBucketMultipartUploads"
      ],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME"
    }
  ]
}
```

Depending on account/bucket settings, you may also need extra multipart permissions such as `s3:ListMultipartUploadParts`.

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

`ETag` must be exposed or multipart completion will fail.

## Usage

1. Enter bucket, region, optional key prefix.
2. Drag files onto the drop zone.
3. Click **Start Upload**.
4. Monitor per-file and overall progress bars.
5. After upload is complete, make the bucket private again.

## Notes

- S3 multipart minimum part size is 5 MB (except final part).
- If your bucket name contains dots and TLS/endpoint issues occur, enable path-style mode in the UI.
- This is intentionally for temporary, one-off uploads. Do not leave anonymous write policies enabled.
