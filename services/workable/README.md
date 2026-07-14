# Workable FlowRunner Extension

Automate recruiting and applicant tracking with the [Workable SPI v3 API](https://workable.readme.io/reference). List and read jobs, create and move candidates through hiring pipeline stages, post comments and ratings, read the account roster, and watch for new candidates.

## Ideal Use Cases

- Source a candidate from an external form or CRM and create them on the right job.
- Advance candidates through pipeline stages and disqualify or revert them automatically.
- Log hiring-team feedback as comments and ratings from a review workflow.
- Trigger downstream automations whenever a new candidate applies.

## List of Actions

- List Jobs
- Get Job
- Get Job Members
- Get Job Stages
- List Candidates
- Get Candidate
- Create Candidate
- Update Candidate
- Move Candidate to Stage
- Disqualify Candidate
- Revert Candidate
- Copy Candidate to Job
- List Candidate Activities
- Create Comment
- Create Rating
- List Members
- List Recruiters
- List Stages
- Get Account

## List of Triggers

- **On New Candidate** (polling) — fires when a new candidate is added, optionally scoped to a single job.

## Configuration

| Setting | Required | Description |
| ------- | -------- | ----------- |
| Subdomain | Yes | Your Workable subdomain — e.g. `acme` for `acme.workable.com`. |
| Access Token | Yes | API Access Token / Partner token from Workable → Settings → Integrations. Sent as a `Bearer` token. |

The base URL is derived per account as `https://{subdomain}.workable.com/spi/v3`, and every request sends `Authorization: Bearer <accessToken>`.

## Data Model Notes

- **Jobs** are referenced by their **shortcode** (e.g. `GHI789`), not the numeric id. The **Get Jobs Dictionary** backs a searchable job picker on every shortcode field; you may also type a shortcode directly.
- **Candidates** are referenced by their **id**. Create Candidate applies a candidate to a job by shortcode; set **Sourced** to add them to the sourced stage rather than as an inbound applicant.
- **Stages** are addressed by **slug** (e.g. `phone_screen`). Use **Get Job Stages** to list the valid slugs for a candidate's job before calling **Move Candidate to Stage** or **Copy Candidate to Job**.
- **Comments** support a Public/Private visibility policy; private comments are restricted to the member ids you supply.
- Errors surface Workable's `error` message and `validation_errors` along with the HTTP status.

## Agent Ideas

- On a new form submission, use **Workable** "Create Candidate" to add the applicant, then **Slack** "Send Message To Channel" to notify the hiring channel.
- Watch **Workable** "On New Candidate", then **OpenAI** to score the resume and **Workable** "Create Rating" to record the evaluation.
- After an interview, use **Workable** "Move Candidate to Stage" and **Workable** "Create Comment" to advance and annotate the candidate in one flow.
