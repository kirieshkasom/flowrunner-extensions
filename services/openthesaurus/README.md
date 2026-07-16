# OpenThesaurus FlowRunner Extension

Look up **German-language synonyms** using the free, public [OpenThesaurus](https://www.openthesaurus.de) thesaurus. No authentication or API key is required. Results are grouped into synonym sets (synsets) where every term is a synonym of the query word; both the query and all returned terms are German words.

## Ideal Use Cases

- Enriching German content with alternative word choices during automated writing or editing workflows.
- Suggesting phonetically similar words to correct likely typos in user-submitted German text.
- Expanding search or tagging vocabularies by pulling related German terms for a keyword.
- Feeding synonym groups into an AI prompt to vary phrasing or improve German copy.

## List of Actions

### Thesaurus

- Get Synonyms

## List of Triggers

This service does not define any triggers.

## Authentication

None. OpenThesaurus is a free, public API with no key or account required, so this service has **no configuration items**. The API is rate limited to roughly 60 requests per minute per IP address; for bulk usage, OpenThesaurus recommends downloading their database instead.

## Notes

- **Get Synonyms** takes a required **Word** plus optional flags — Similar Words (up to five phonetically close terms with Levenshtein distance), Substring Matches, Starts With, Include Sub-Synsets (hyponyms / more specific), Include Super-Synsets (hypernyms / more general), and Base Form. Each flag defaults to `false` and is applied only when enabled.
- Unknown words are **not** errors: the response simply returns an empty `synsets` array. HTTP/transport failures are surfaced as errors with their status code.
- Every request sends `format=application/json`; without it the API returns XML by default.
- There is no autocomplete / suggestions endpoint in the OpenThesaurus API, so this service does not offer one — the Starts With option is the closest prefix match.

## Attribution

Data provided by [OpenThesaurus](https://www.openthesaurus.de), licensed under Creative Commons Attribution-ShareAlike 4.0 / GNU LGPL 2.1.

## Agent Ideas

- Call **OpenThesaurus** "Get Synonyms" to gather German alternatives for a keyword, then pass them to **DeepL** "Translate Text" to produce matching translations in another language.
- Use **OpenThesaurus** "Get Synonyms" to build a list of related German terms and feed them into **OpenAI** "Create Chat Completion" to rewrite a paragraph with more varied vocabulary.
- Pull synonym groups with **OpenThesaurus** "Get Synonyms" and log each term with **Google Sheets** "Add Row" to maintain a German keyword and synonym reference sheet.
