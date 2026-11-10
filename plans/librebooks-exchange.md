# LibreBooks exchange (LibreHours side)

The design lives in LibreBooks:
`C:\Users\camer\git\Personal Projects\LibreBooks\plans\librehours-integration.md`
(repo `cinderblock/LibreBooks`, same path). Read it first.

Summary: a new `librebooks` accounting backend. It speaks one protocol in both
directions, and the admin chooses which.

- *Pull*: LibreBooks calls `/api/exchange/v1/*` here with an exchange key
  minted on the Accounting page.
- *Push*: on submit, this app sends to LibreBooks with an integration token
  minted there.

The backend becomes an admin setting. `ACCOUNTING_BACKEND` still pins it when
set.

LibreHours' phases (2: steps 6–9, and 3: step 10) are tracked in the LibreBooks
plan's progress log, not here.
