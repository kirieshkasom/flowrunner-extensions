# Workable FlowRunner Extension

Automate recruiting and applicant tracking with the [Workable SPI v3 API](https://workable.readme.io/reference). List and read jobs, create and move candidates through hiring pipeline stages, post comments and ratings, read the account roster, and watch for new candidates.

## Ideal Use Cases

- Source a candidate from an external form or CRM and create them on the right job.
- Advance candidates through pipeline stages and disqualify or revert them automatically.
- Copy or relocate a strong candidate into another job's pipeline.
- Log hiring-team feedback as comments and ratings from a review workflow.
- Trigger downstream automations whenever a new candidate applies.

## List of Actions

### Jobs

- List Jobs
- Get Job
- Get Job Members
- Get Job Stages

### Candidates

- List Candidates
- Get Candidate
- Create Candidate
- Update Candidate
- Move Candidate to Stage
- Disqualify Candidate
- Revert Candidate
- Copy Candidate to Job
- Relocate Candidate to Job
- List Candidate Activities

### Comments & Ratings

- Create Comment
- Create Rating

### Members & Recruiters

- List Members
- List Recruiters

### Stages

- List Stages

### Account

- Get Account

## List of Triggers

- **On New Candidate** (polling) — fires when a new candidate is added to the account, optionally scoped to a single job. The first cycle establishes a baseline and emits nothing; later cycles emit one event per new candidate.

## Configuration

| Setting | Required | Description |
| ------- | -------- | ----------- |
| Subdomain | Yes | Your Workable subdomain — e.g. `acme` for `acme.workable.com`. |
| Access Token | Yes | Workable → Settings → Integrations → Access Token. Sent as a `Bearer` token. Account tokens are scoped to this subdomain; partner tokens require a subdomain per call. |

The base URL is derived per account as `https://{subdomain}.workable.com/spi/v3`, and every request sends `Authorization: Bearer <accessToken>`.

## Data Model Notes

- **Jobs** are referenced by their **shortcode** (e.g. `GHI789`), not the numeric id. The **Get Jobs Dictionary** backs a searchable job picker on every shortcode field; you may also type a shortcode directly.
- **Candidates** are referenced by their **id**. Create Candidate applies a candidate to a job by shortcode; leave **Sourced** on to add them to the sourced stage, or turn it off to treat them as an inbound applicant (which triggers Workable's applicant thank-you email).
- **Member id required.** The candidate-action operations — Move Candidate to Stage, Disqualify Candidate, Copy Candidate to Job, Relocate Candidate to Job, Create Comment, and Create Rating — require a **Member ID** identifying the person performing the action. The **Get Members Dictionary** backs a searchable member picker on these fields; you may also type a member id, or list them with **List Members**.
- **Stages** are addressed by **slug** (e.g. `phone_screen`). Use **Get Job Stages** to list the valid slugs for a candidate's job before calling **Move Candidate to Stage** or targeting a stage on Copy/Relocate.
- **Copy vs. Relocate.** **Copy Candidate to Job** adds the candidate to another job's pipeline while keeping them on the original; **Relocate Candidate to Job** moves them off the original.
- **Comment visibility** is controlled by the **Visible To Roles** list (Admin, Recruiting Admin, Hiring Manager, Recruiter, Reviewer, Simple). Leave it empty for Workable's default visibility; comments are always visible to admins regardless.
- **Ratings** use Workable's scale/grade model. Pick a **Scale** (Thumbs, Stars, or Numbers) and a **Grade** whose valid range depends on the scale: Thumbs 0-2 (negative/positive/definite), Stars 0-4 (one to five stars), Numbers 0-9 (1 to 10 out of 10).
- Errors surface Workable's `error` message and `validation_errors` along with the HTTP status.

## Agent Ideas

- On a new form submission, use **Workable** "Create Candidate" to add the applicant, then **Slack** "Send Message To Channel" to notify the hiring channel.
- Watch **Workable** "On New Candidate", then **OpenAI** to score the resume and **Workable** "Create Rating" to record the evaluation.
- After an interview, use **Workable** "Move Candidate to Stage" and **Workable** "Create Comment" to advance and annotate the candidate in one flow.
