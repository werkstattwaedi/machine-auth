# Explain Task

Provide an in-depth explanation of an NTAG 424 DNA feature, authentication flow, or SUN/SDM configuration.

## Process

### 1. Gather Documentation

1. Read knowledge base at `.claude/agents/ntag424-expert/knowledge/overview.md`
2. For specific details, read relevant page images from:
   - `.claude/agents/ntag424-expert/pages/datasheet/` (main spec)
   - `.claude/agents/ntag424-expert/pages/an12196/` (SUN/SDM details)
3. Always cite document and page numbers

### 2. Analyze the Topic

Understand deeply:
- What is the purpose of this feature?
- What security properties does it provide?
- What are the cryptographic operations involved?
- What are the configuration options?
- What are common implementation mistakes?
- What are the security implications of misconfiguration?

## Output Format

### Overview
What this feature does and when to use it (2-3 paragraphs)

### Security Properties
What security guarantees this feature provides.

### APDU Format
```
Command APDU:
CLA: XX  INS: XX  P1: XX  P2: XX
Lc: XX
Data: [description of each byte]
Le: XX

Response APDU:
Data: [description of response fields]
SW1-SW2: Expected status words
```

### Cryptographic Details
For features involving crypto:
- Key derivation (if applicable)
- Encryption mode (CBC, etc.)
- IV/nonce handling
- MAC calculation

### Configuration
For configurable features:
- Available options
- Recommended settings
- Security tradeoffs

### Implementation Example
```c
// Complete working example with proper error handling
```

### Common Mistakes
Security pitfalls and how to avoid them.

### Related Features
Other NTAG 424 features that work with this one.

### Documentation References
- Datasheet: Pages X, Y, Z
- AN12196: Pages A, B, C
