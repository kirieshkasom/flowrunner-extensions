# AWS Bedrock FlowRunner Extension

Run inference against [Amazon Bedrock](https://aws.amazon.com/bedrock/) foundation models (Anthropic Claude, Amazon Nova/Titan, Meta Llama, Mistral, Cohere, Stability AI, and more) and discover the models available in your region. Authentication uses standard AWS credentials via hand-rolled SigV4 signing (zero npm dependencies), supporting both direct access keys and cross-account IAM Role (STS AssumeRole).

## Ideal Use Cases

- Add multi-model chat/LLM inference to a flow with a single unified payload that works across every chat-capable Bedrock model.
- Generate images from text prompts and store them as downloadable FlowRunner files.
- Run provider-native payloads (embeddings, image generation, model-specific parameters) that the unified Converse API does not expose.
- Discover which foundation models are enabled and available in a given AWS region before invoking them.

## List of Actions

- Converse
- Generate Image
- Get Foundation Model
- Invoke Model
- List Foundation Models

## List of Triggers

This service does not define any triggers.

## Configuration

This service uses the shared AWS configuration (SigV4 signing; not OAuth):

- **Authentication Method** — `API Key` (use the access key directly) or `IAM Role` (assume a role via STS for cross-account access).
- **Region** — AWS region code, e.g. `us-east-1`, `eu-west-1`. Determines which models and endpoints are used.
- **Access Key** / **Secret Key** — AWS access key ID and secret access key (required for both methods).
- **IAM Role ARN** — ARN of the role to assume, e.g. `arn:aws:iam::123456789012:role/MyRole` (required for IAM Role auth).
- **External ID** — optional external ID for cross-account role assumption.

Endpoints are derived from the region: runtime calls go to `bedrock-runtime.{region}.amazonaws.com`, model discovery to `bedrock.{region}.amazonaws.com`. Requests are signed for the `bedrock` service.

## Notes

- **Model access is region-gated.** Bedrock models are not available in every region, and each model must be explicitly enabled for your account in the AWS console (Bedrock → Model access) before it can be invoked. Use **List Foundation Models** or the model dropdown to see what is available in your configured region. Many newer models are only reachable through a cross-region **inference profile** (e.g. `us.anthropic.claude-3-5-sonnet-20241022-v2:0`) rather than the bare model ID.
- **Converse vs. Invoke Model.** **Converse** is the recommended operation: a single unified request/response shape across all chat-capable models, so you can switch models without rewriting your payload. Supply a full `messages` array, or just a `prompt` (and optional `system`) for the simple single-turn case. **Invoke Model** is the lower-level escape hatch that sends a model-specific request body straight through and returns the model-specific response unchanged — use it for embeddings, image generation, or provider-native parameters. The body shape depends entirely on the target provider (e.g. Anthropic expects `{"anthropic_version":"bedrock-2023-05-31","max_tokens":1024,"messages":[...]}`, Amazon Titan Text expects `{"inputText":"..."}`).
- **Generate Image** is a convenience wrapper over Invoke Model for image models (Amazon Titan Image Generator, Stability); it decodes the base64 image and saves it to FlowRunner file storage, returning a downloadable URL.
- **Streaming is not supported.** Bedrock's `ConverseStream` / `InvokeModelWithResponseStream` are not implemented — the runtime returns a single complete response. Use **Converse** for the non-streamed response.
- A model dropdown (backed by a dictionary) powers model selection across the operations above.

## Agent Ideas

- Use **AWS Bedrock** "Converse" to draft a customer reply from an incoming message, then send it with **Amazon SES** "Send Email".
- Use **AWS Bedrock** "Generate Image" to create marketing artwork from a prompt, then call **S3 Storage** "Upload Object from URL" to archive the generated image in a bucket.
- When a **Google Sheets** "On New Row" trigger fires with support-ticket text, use **AWS Bedrock** "Converse" to classify and summarize it, then use **Slack** "Send Message To Channel" to route the summary to the on-call team.
