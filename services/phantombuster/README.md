# Phantombuster FlowRunner Extension

Launch and manage [Phantombuster](https://phantombuster.com) automation agents (phantoms) and retrieve their scraped results using the Phantombuster API v2. Start a phantom, poll its run to completion, and pull back the structured data it collected.

## Ideal Use Cases

- Launch a scraping/automation phantom (e.g. a LinkedIn or Instagram scraper) with a custom input configuration, then collect the results.
- Poll a running agent or container until it finishes and read the structured result object.
- List your agents and their past runs, and abort a run that is stuck or no longer needed.
- Check organization resource usage and quotas before launching agents.

## The Launch → Poll → Fetch Result Flow

Phantombuster agents run asynchronously in containers. The typical flow is:

1. **Launch Agent** with the agent `id` and an optional `argument` object (agent-specific input, e.g. a session cookie, spreadsheet URL, or number of profiles). This returns a `containerId`.
2. **Poll** with **Get Agent Output** (by agent id) or **Get Container** (by container id) until the run's `status` is `finished`.
3. **Get Container Result Object** with the `containerId` to retrieve the structured JSON result - the scraped/automated data.

## List of Actions

- List Agents
- Get Agent
- Launch Agent
- Get Agent Output
- Abort Agent
- Get Container
- Get Container Result Object
- List Agent Containers
- Get Organization Resources

## List of Triggers

This service has no triggers.

## Configuration

| Setting | Required | Description |
| ------- | -------- | ----------- |
| API Key | Yes | Your Phantombuster API key, sent as the `X-Phantombuster-Key-1` header. Find it in Phantombuster under Workspace settings > API key (Org API key). |

## Notes

- **Agent arguments:** The **Argument** and **Bonus Argument** inputs on Launch Agent are JSON objects specific to each phantom (fields differ per agent - e.g. `sessionCookie`, `spreadsheetUrl`, `numberOfProfiles`). Inspect an agent with **Get Agent** to see its expected argument shape. Set **Save Argument** to persist the argument as the agent's default; leave it off for a one-off run.
- **Result object:** Result objects are returned as a JSON string in the `resultObject` field and must be parsed to access the collected records.
- The **Agent ID** fields are backed by a searchable agent picker (powered by List Agents); you may also paste an id directly.

## Agent Ideas

- Use **Phantombuster** "Launch Agent" to run a lead-scraping phantom, then after polling, **Phantombuster** "Get Container Result Object" and **Google Sheets** "Add Row" to log each scraped lead.
- Combine **Phantombuster** "Get Agent Output" polling with **Airtable** "Create Record" to store scraped profiles as they finish.
- Use **Phantombuster** "Get Organization Resources" on a schedule and **Gmail** "Send Message" to alert when execution-time quota runs low.
