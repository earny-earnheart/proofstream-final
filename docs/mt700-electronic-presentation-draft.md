# Proposed electronic-presentation conditions — bank/counsel working draft

Not an issued credit, bank-approved SWIFT message, or verified ICC model clause.
Replace every bracketed term and reconcile this text with the full credit, UCP 600,
the incorporated eUCP version and the bank's actual presentation infrastructure.
Do not cite a specific eUCP subsection until checked against the licensed text.
Field lengths, character set and use of continuation messages require bank validation.

## Proposed Field 47A narrative (subject to bank agreement)

THIS CREDIT IS SUBJECT TO UCP 600 AS SUPPLEMENTED BY EUCP VERSION 2.1.
ELECTRONIC PRESENTATION SHALL BE MADE THROUGH [BANK-ACCEPTED PRESENTATION
SYSTEM AND ELECTRONIC ADDRESS] BY [CUTOFF TIME AND TIME ZONE] ON OR BEFORE
[EXPIRY DATE]. THE SYSTEM SHALL ISSUE A RECEIPT IDENTIFYING THE CREDIT,
DOCUMENT SET AND TIME OF RECEIPT. MERE PUBLICATION TO A BLOCKCHAIN OR
CONTENT-ADDRESSED STORE DOES NOT CONSTITUTE RECEIPT BY THE BANK.

THE ELECTRONIC RECORDS SPECIFIED IN FIELD 46A MAY BE PRESENTED IN
[AGREED FORMATS AND VERSIONS]. THE ACCOMPANYING AUTHENTICATION MANIFEST
MAY USE EIP-712 ONLY THROUGH THE AGREED VERIFICATION SYSTEM DESCRIBED IN
[TECHNICAL SCHEDULE IDENTIFIER AND VERSION], EXPRESSLY ACCEPTED BY THE
ISSUING BANK AND EACH BANK REQUIRED TO RECEIVE OR EXAMINE THAT PRESENTATION.

THE MANIFEST SHALL IDENTIFY THIS CREDIT, THE BENEFICIARY, EACH REQUIRED
DOCUMENT, ITS CONTENT DIGEST AND RETRIEVAL REFERENCE, THE AUTHORIZED SIGNER,
A UNIQUE PRESENTATION IDENTIFIER, NONCE AND EXPIRY. THE AUTHENTICATION DOMAIN
SHALL SPECIFY [CHAIN ID], [VERIFYING CONTRACT ADDRESS], [NAME] AND [VERSION].
THE AGREED SYSTEM SHALL CHECK SIGNER AUTHORITY AND REVOCATION, DOMAIN,
NONCE REUSE, EXPIRY AND THE DIGEST OF EACH RECEIVED DOCUMENT. RECORDS MUST
REMAIN ACCESSIBLE AND CAPABLE OF EXAMINATION THROUGH [RETENTION PERIOD].

NOTICE OF COMPLETENESS SHALL BE PROVIDED THROUGH [AGREED MECHANISM],
IDENTIFYING THIS CREDIT AND THE COMPLETE PRESENTATION SET. RECEIPT,
COMPLETENESS AND AUTHENTICATION DO NOT THEMSELVES CONSTITUTE COMPLIANCE,
ACCEPTANCE OF DOCUMENTS OR AN UNDERTAKING TO PAY BEYOND THIS CREDIT.

SYSTEM UNAVAILABILITY, CORRUPTION, RE-PRESENTATION AND ALTERNATIVE DELIVERY
SHALL BE HANDLED UNDER THE APPLICABLE RULES AND [AGREED CONTINGENCY PROCEDURE].
NO ALTERNATIVE DELIVERY METHOD IS EFFECTIVE WITHOUT THE AGREEMENT REQUIRED
BY THIS CREDIT AND THE APPLICABLE RULES.

## Field 46A and technical schedule dependencies

- Enumerate the actual required documents, issuer, format, language and signature
  requirements. A digest or CID is not a substitute for the document itself.
- Specify document-set canonicalization (e.g. a digest of a versioned manifest),
  EIP-712 types, signing/verification code, nonce scope, key rotation, revocation,
  contract-wallet verification if used, and bank-maintained authorization records.
- Specify whether chain inclusion is required, the finality policy, upgrade handling,
  and bank-receipt timestamp source. The signer's timestamp must not determine receipt.
- Define confidentiality, retrieval access, availability, retention and evidence export.
  Avoid publishing financial or personal documents to public permanent storage.
- Test a successful presentation, missing document, digest mismatch, unauthorized
  signer, replay, chain mismatch, revoked key, late presentation and system outage
  in the bank's accepted system before incorporating the schedule into an issued credit.
