# SurveyMonkey FlowRunner Extension

FlowRunner service for the [SurveyMonkey API v3](https://developer.surveymonkey.com/api/v3/). Manage surveys, responses, collectors, pages, and questions using a SurveyMonkey private-app access token (sent as an `Authorization: Bearer <token>` header on every request).

## Ideal Use Cases

- Export survey responses into a spreadsheet or database for reporting and analysis.
- Automatically notify a team when new responses come in and translate answer IDs into readable text.
- Programmatically create surveys and web link or email collectors, then distribute the share URL.
- Audit account surveys, pages, and questions, or verify connectivity via the authenticated user.

## List of Actions

### Surveys

- Create Survey
- Delete Survey
- Get Survey
- Get Survey Details
- List Surveys

### Responses

- Get Response Details
- List All Responses Bulk
- List Survey Responses

### Collectors

- Create Collector
- Get Collector
- Get Collector Responses
- List Collectors

### Pages & Questions

- Get Page
- List Page Questions
- List Survey Pages

### Account

- Get Me

## Reading response answers (important)

Response answers returned by **Get Response Details** and **List All Responses Bulk** reference question and answer-choice **IDs** (`choice_id`, `row_id`, `col_id`) rather than human-readable text. To translate them into question headings and choice labels you must combine them with the survey structure from **Get Survey Details**, which lists each question's `heading` and each answer choice's `id` and `text`.

For convenience, **Get Response Details** accepts an **Include Survey Mapping** option. When enabled, it fetches the survey structure automatically and attaches a readable `mapped_answers` array (`{ question, answers[] }`) alongside the raw response, at the cost of one extra API call.

## Authentication

This service authenticates with a SurveyMonkey **access token**. To obtain one:

1. Sign in at [developer.surveymonkey.com](https://developer.surveymonkey.com).
2. Create a **private app** in the developer portal.
3. Copy the app's **access token** and paste it into the **Access Token** config item.

Private-app tokens do not expire and grant access to the resources selected as scopes when the app was created, so make sure the app has the scopes it needs (surveys, responses, collectors).

## Configuration

| Item         | Required | Description                                                    |
| ------------ | -------- | -------------------------------------------------------------- |
| Access Token | Yes      | Access token of your SurveyMonkey private app (Bearer token). |

## Agent Ideas

- Use SurveyMonkey **"List All Responses Bulk"** together with **"Get Survey Details"** to translate answer IDs to text, then Google Sheets **"Add Rows"** to export each response into a reporting spreadsheet.
- After SurveyMonkey **"Create Collector"** (Web Link), use Slack **"Send Message To Channel"** to share the generated survey URL with your team.
- Use SurveyMonkey **"Get Response Details"** with Include Survey Mapping enabled, then use HubSpot to update the corresponding contact or log a follow-up based on flagged answers.
