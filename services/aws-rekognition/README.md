# AWS Rekognition FlowRunner Extension

Zero-dependency integration with Amazon Rekognition using native AWS Signature V4 signing (Node crypto). Analyze images for objects, text, faces, unsafe content, celebrities, and protective equipment, and build searchable face collections. Requests use the AWS JSON 1.1 protocol (POST to `rekognition.{region}.amazonaws.com` with an `X-Amz-Target` header). Supports two authentication methods: direct API Key credentials or IAM Role via STS AssumeRole for cross-account access.

## Ideal Use Cases

- Auto-tagging and categorizing uploaded images by detecting objects, scenes, and activities
- Extracting text from photos, signs, screenshots, and scanned documents (OCR)
- Moderating user-generated images by flagging explicit, violent, or otherwise unsafe content
- Verifying identity by comparing a submitted photo against a reference image or a face collection
- Building and searching a face collection to recognize returning people across images
- Enforcing workplace safety by detecting whether people are wearing required PPE (face, hand, head covers)
- Recognizing celebrities or public figures in media assets

## Image Input Options

Every image operation accepts the image in one of two ways:

- **Image URL** — an HTTP(S) URL or a FlowRunner file URL. The bytes are downloaded and sent inline (base64). Inline image bytes are limited to **5 MB** by Rekognition.
- **S3 object** — an S3 **Bucket** and object **Name**. Preferred for larger images and for images already stored in S3. When both S3 fields are supplied they take precedence over the Image URL.

Compare Faces takes two images (source and target), each independently supplied via URL or S3.

## Authentication

Requests are signed with AWS Signature Version 4 (`rekognition` service). Provide credentials via the configuration items below.

- **API Key** — uses your access key and secret key directly.
- **IAM Role** — assumes a role via STS AssumeRole (Role ARN, optional External ID) for cross-account access.

## Face Collections

Collections are server-side containers that store searchable face vectors. The typical flow is:

1. **Create Collection** to provision a container.
2. **Index Faces** to add faces from images (optionally tagged with an External Image ID).
3. **Search Faces by Image** to identify a person by matching a new image against indexed faces.
4. **List Faces** / **List Collections** to inspect contents, and **Delete Collection** to remove one.

The **Get Collections Dictionary** powers dropdown selection of collection IDs in the collection operations.

## List of Actions

- Detect Labels
- Detect Text
- Detect Faces
- Detect Moderation Labels
- Recognize Celebrities
- Compare Faces
- Detect Protective Equipment
- Create Collection
- List Collections
- Delete Collection
- Index Faces
- Search Faces by Image
- List Faces

## List of Triggers

This service does not define any triggers.

## Configuration

- **Authentication Method** — `API Key` (access key directly) or `IAM Role` (STS AssumeRole with a Role ARN for cross-account access).
- **Region** — AWS region code where Rekognition runs, e.g. `us-east-1`. Face collections are region-scoped.
- **Access Key** — AWS access key ID (required for both authentication methods).
- **Secret Key** — AWS secret access key (required for both authentication methods).
- **IAM Role ARN** — ARN of the role to assume (required for IAM Role authentication).
- **External ID** — optional external ID for cross-account role assumption.

## Agent Ideas

- When a new image lands in a bucket, use **S3 Storage** "Get Object Metadata" to confirm it, then call **AWS Rekognition** "Detect Moderation Labels" and, on a flag, use **Slack** "Send Message To Channel" to alert moderators with the object key and category.
- Use **AWS Rekognition** "Detect Labels" and "Detect Text" on an image (via an **S3 Storage** "Get Presigned URL" reference), then call **DynamoDB** "Put Item" to persist the extracted tags and text as a searchable record.
- When a user submits an ID photo via URL, use **AWS Rekognition** "Search Faces by Image" against an indexed collection, then use **DynamoDB** "Query" to look up the matched person's profile and **Slack** "Send Message To Channel" to report the verification result.
