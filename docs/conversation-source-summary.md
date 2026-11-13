# Conversation acquisition summaries

Online synchronization, Google Takeout import and OpenAI ZIP import share the
same workbench summary: source method, operation status, conversations read,
new conversations added, and the selected account's current local total.
Online synchronization also reports changed conversation metadata when available.

- **Read/scanned** describes the current operation, rather than a fraction of an
  assumed remote total. Offline counts use distinct conversation identities;
  multiple turns or duplicate archive shards do not imply extra conversations.
- **Added** counts newly created conversation indexes. L2 reports `indexAdded`
  only after the transaction creating an Index commits. Reimporting or refreshing
  an existing conversation does not count as a new conversation. Concurrent
  admissions attribute the addition to one creating transaction.
- **Total** is the current number of local conversation indexes for the selected
  account. It includes every admitted source and is independent of list search,
  filters, selection and other accounts. The completion handler refreshes persisted
  facts before displaying a result; later refreshes update the total.

An import replaces the previous synchronization message in the same summary
position. Switching accounts clears the preceding account's summary. Source
limits remain a partial synchronization outcome, with their specific cause and
page counters retained in logs and the diagnostic report. A Takeout import does
not certify that an account's complete remote history has been obtained.

Tier 2 reads the actual account-bound progress and `ScanResult` from the
`data-sync-evidence` attribute. Translated presentation text is only kept as audit
context; it cannot convert a partial scan into a complete scan. Missing result
facts or a changed account remain failed verification conditions. Archive import
verification likewise reads the account-bound `data-source-summary` result
rather than inferring success from translated text.

Regression checks include overlapping and concurrent imports, repeated OpenAI
and Takeout imports, both UI languages, a partial scan followed by import, account
isolation, unfiltered totals, and an observer accepting translated UI copy only
when the underlying result facts are valid.
