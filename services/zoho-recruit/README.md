# Zoho Recruit FlowRunner Extension

Automate Zoho Recruit applicant tracking — candidates, job openings, applications, and interviews. Move applicants through stages and attach notes, tags, tasks, and emails. Universal actions reach any module. OAuth2, all Zoho data centers.

## Ideal Use Cases

- Sync new and changed records into other systems via triggers.
- Parse resumes into candidates; advance applicants through stages.
- Schedule interviews and log notes, tasks, and emails on records.

## List of Actions

**Records**: Get, List, Create, Update, Upsert, Delete, Search, Build Search Criteria
**Candidates**: Create, Get, Update, Delete, Search, List, Parse Resume, Upload Resume, Associate To Job Opening
**Job Openings**: Create, Get, Update, Change Status, Close, Delete, List
**Applications**: List, Get, Change Status, Update
**Interviews**: Schedule, List, Get, Update, Cancel
**Notes**: Add To Record, List For Record, Update, Delete
**Attachments**: List, Upload, Attach Link, Download, Delete
**Tags**: Add To Records, Remove From Records
**Tasks**: Create, List, Update
**Email**: Send To Record
**Metadata**: List All Modules, List Module Fields, List Module Layouts, List Module Custom Views, List Recruiters, Get Org Info

## List of Triggers

**Realtime**: On Candidate Created/Updated/Deleted, On Job Opening Created/Updated, On Application Created/Updated, On Interview Created/Updated
**Polling**: On New Or Updated Candidate, Job Opening, Application, Interview

## Agent Ideas

- On **Zoho Recruit** "On Interview Created (Realtime)", use **Google Calendar** "Create Event" and **Gmail** "Send Message" to notify them.
- On **Zoho Recruit** "On New Or Updated Application (Polling)", post to **Slack** "Send Message To Channel", then log it with **Zoho Recruit** "Add Note To Record".
- Pair **Zoho Recruit** "Get Candidate" with **DocuSign** "Send Envelope from Template"; on **DocuSign** "On Envelope Completed", call **Zoho Recruit** "Change Application Status".
