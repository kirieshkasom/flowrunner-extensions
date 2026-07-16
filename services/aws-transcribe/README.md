# AWS Transcribe FlowRunner Extension

Convert speech in audio and video files into text using [Amazon Transcribe](https://docs.aws.amazon.com/transcribe/). Start and manage asynchronous, S3-based transcription jobs and custom vocabularies directly from your FlowRunner flows. Authenticates to AWS with native SigV4 request signing (no SDK dependency).

## Ideal Use Cases

- Transcribe recorded calls, meetings, podcasts, or voicemails stored in Amazon S3 into searchable text.
- Auto-detect the spoken language of uploaded media, or transcribe a known language.
- Partition transcripts by speaker (diarization) or by audio channel for stereo call recordings.
- Improve accuracy for domain-specific terms, product names, and acronyms with custom vocabularies.
- Generate subtitle files (WebVTT / SubRip) from media as part of a media-processing pipeline.

## List of Actions

### Transcription Jobs

- Start Transcription Job
- Get Transcription Job
- List Transcription Jobs
- Delete Transcription Job

### Custom Vocabularies

- Create Vocabulary
- Get Vocabulary
- List Vocabularies
- Delete Vocabulary

## List of Triggers

This service does not define any triggers.

## How Transcription Works

Amazon Transcribe is **asynchronous and S3-based**:

1. **Upload your media to Amazon S3.** The input audio/video file must already exist in an S3 bucket that Transcribe can read. You reference it by its S3 URI, e.g. `s3://my-bucket/recordings/call.mp3`.
2. **Start a job** with **Start Transcription Job**. Transcribe processes the file in the background and returns immediately with a status of `QUEUED` or `IN_PROGRESS`.
3. **Poll the job** with **Get Transcription Job** until its status becomes `COMPLETED` (or `FAILED`). When complete, the result includes a `transcriptFileUri` pointing to the transcript JSON.
4. **Read the transcript.** Where the transcript is written depends on how you started the job:
   - **No Output Bucket** (default): the transcript is stored in a Transcribe-managed S3 bucket and returned as a temporary, presigned `transcriptFileUri`. Enable **Fetch Transcript Text** on **Get Transcription Job** to have this service download and parse that JSON and return the plain transcript text (`results.transcripts[0].transcript`).
   - **With an Output Bucket**: the transcript is written into your own S3 bucket. The `transcriptFileUri` points into that bucket and typically requires S3 access to read, so automatic text fetching may not succeed unless the URI is publicly reachable.

## Configuration

Authentication uses AWS SigV4 request signing. Configure these items:

- **Authentication Method** (required) — `API Key` (direct access key) or `IAM Role` (STS AssumeRole for cross-account access).
- **Region** (required) — AWS region code, e.g. `us-east-1`, `eu-west-1`. Transcribe uses `transcribe.{region}.amazonaws.com`.
- **Access Key** — AWS access key ID. Required for both methods.
- **Secret Key** — AWS secret access key. Required for both methods.
- **IAM Role ARN** — ARN of the role to assume. Required for `IAM Role` authentication.
- **External ID** — Optional external ID for cross-account role assumption.

The IAM identity needs permissions for the Transcribe actions you call (e.g. `transcribe:StartTranscriptionJob`, `transcribe:GetTranscriptionJob`), plus S3 read access to the input media and, when using an output bucket, S3 write access to it.

## Notes

- **Speaker labels vs. channel identification.** Enable **Show Speaker Labels** with **Max Speaker Labels** (2–30) to partition the transcript by speaker (diarization). This cannot be combined with **Channel Identification**, which instead transcribes each audio channel separately (useful for stereo call recordings).
- **Language codes.** Common codes are offered in dropdowns (e.g. `en-US`, `en-GB`, `es-US`, `fr-FR`, `de-DE`, `ja-JP`, `zh-CN`), but you may type any valid Transcribe language code. See [Supported languages](https://docs.aws.amazon.com/transcribe/latest/dg/supported-languages.html).
- **Custom vocabularies** are created asynchronously — the state is usually `PENDING` and becomes `READY` (or `FAILED`). Check with **Get Vocabulary** before applying it to a transcription job.
- **Dictionaries.** Internal dictionary helpers power searchable dropdowns for selecting a vocabulary or job name in other operations.
- **Errors.** Transcribe returns errors as `__type` + `message`. Common cases: `ConflictException` (a job or vocabulary with that name already exists — names must be unique per account), `BadRequestException` (validation failure, e.g. invalid S3 URI or language code), and `LimitExceededException` (too many requests or an over-long input — wait and retry).

## Agent Ideas

- Use **S3 Storage** "Upload Object from URL" to land a recording in S3, then call **AWS Transcribe** "Start Transcription Job" against its S3 URI to kick off transcription.
- After **AWS Transcribe** "Get Transcription Job" returns `COMPLETED` with `transcriptFileUri`, use **S3 Storage** "Get Presigned URL" to produce a shareable link to the transcript stored in your output bucket.
- When an **AWS Transcribe** "Get Transcription Job" poll shows a completed transcript, use **Amazon SES** "Send Email" to deliver the plain transcript text to stakeholders by email.
