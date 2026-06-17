# Scam Evolution And Hackathon Winning Strategy

Date: 2026-06-12

## Question

How have job/interview scams and fraud-detection systems evolved, and what should Verify My Interview improve or emphasize to become a stronger Microsoft Foundry hackathon submission?

## Decision This Informs

Prioritize the next product, scoring, agent, UI, and demo improvements before the 2026-06-14 hackathon submission.

## Evidence Bar

- Current app behavior must be grounded in the repo before external research.
- Load-bearing external claims need either one authoritative primary source or at least two independent current sources.
- Sources must be date-stamped and linked.
- No real victim/person PII should be searched.

## Research Loop Notes

### Round 0: Project Grounding

- Current app already has the right spine for modern fraud: evidence intake, Foundry specialist agents, deterministic scoring, cited guidance, graph matching, voice transcription, privacy redaction, and deterministic fallback.
- Strong shipped differentiators: hard-identifier entity graph, structural network signals, Critic stage, Microsoft Foundry trace, Azure AI Search corpus, Azure Speech voice intake, and Sentinel UI dossier.
- Current gaps most relevant to research: report-vs-check triage, fuller plain-language source strings, stronger confidence-as-agreement, more live-case fixtures, report/chat grounding with Foundry IQ or Azure AI Search tool, Prompt Shields, observability/evals, and distribution where victims are: WhatsApp/social.

### Round 1: Scam Evolution

- Established: job scams now look like normal hiring. FTC says scammers advertise where real employers do and want money/personal data; BBB says newer job scams use real employer names, interviews, and phony offer letters.
  - Sources accessed 2026-06-12: [FTC Job Scams](https://consumer.ftc.gov/articles/job-scams), [BBB job scam alert](https://www.bbb.org/article/scams/28372-bbb-scam-alert-how-to-spot-a-job-scam-no-matter-how-sophisticated).
- Established: task/gamified job scams surged. FTC reported job-scam losses more than tripled from 2020 to 2023 and topped $220M in the first half of 2024; task scams grew to about 20,000 reports in that half-year and often start by text or WhatsApp, use "optimization/product boosting" language, fake app balances, deposits, and crypto.
  - Source accessed 2026-06-12: [FTC Data Spotlight: task scams](https://www.ftc.gov/news-events/data-visualizations/data-spotlight/2024/12/paying-get-paid-gamified-job-scams-drive-record-losses).
- Established: text/messaging is a major entry channel. FTC reported $470M in 2024 losses from scams that started with text messages and listed phony job opportunities among common text scams.
  - Source accessed 2026-06-12: [FTC top text scams of 2024](https://www.ftc.gov/news-events/news/press-releases/2025/04/new-ftc-data-show-top-text-message-scams-2024-overall-losses-text-scams-hit-470-million).
- Established: AI and synthetic media are now part of employment/cyber fraud. IC3's 2025 annual report reports over 22,000 AI-related complaints, more than $893M adjusted losses, and almost $13M in AI-involved employment-type scams.
  - Source accessed 2026-06-12: [2025 IC3 Annual Report PDF](https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf).
- Established for South Africa: local job scams are strongly social/WhatsApp/payment/ID-data shaped. Standard Bank, Capitec, SAnews/SAPS and Africa Check all point to social or WhatsApp job ads, upfront training/application fees, high pay/no experience/no interview claims, and sensitive information capture.
  - Sources accessed 2026-06-12: [Standard Bank warning](https://www.standardbank.co.za/southafrica/news-and-media/newsroom/standard-bank-warns-public-about-fake-job-advertisements), [Capitec job scam advice](https://www.capitecbank.co.za/fraud-centre/stay-safe-from-job-scams/), [SAnews SAPS vacancy scam](https://www.sanews.gov.za/south-africa/saps-warns-public-vacancy-scam), [Africa Check SAPS hiring fact-check](https://africacheck.org/fact-checks/meta-programme-fact-checks/south-african-police-service-not-hiring-ignore-social-media).

### Round 2: Fraud Detection Patterns

- Established: modern fraud detection is multi-signal and real-time. Microsoft Fabric's reference architecture combines streaming ingestion, historical pattern analysis, ML risk scoring, and immediate alerts across channels.
  - Source accessed 2026-06-12: [Microsoft Fabric fraud detection architecture](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/architectures/fraud-detection).
- Established: vector/anomaly detection can learn user/entity-specific baselines. Microsoft's Cosmos DB sample uses embeddings, vector search, centroid distance, dynamic thresholds, and change-feed streaming for fraud detection.
  - Source accessed 2026-06-12: [Microsoft real-time fraud detection with vector search sample](https://learn.microsoft.com/en-us/samples/azurecosmosdb/cosmos-fabric-samples/fraud-detection/).
- Established: graph/context reduces false positives and detects rings. Neo4j, TigerGraph, NVIDIA, and Senzing all converge on the same principle: fraud is relational; shared devices/accounts/IPs/emails/phones/infrastructure reveal hidden risk that per-message rules miss.
  - Sources accessed 2026-06-12: [Neo4j graph fraud approach](https://neo4j.com/developer/industry-use-cases/finserv/retail-banking/ieee-cis-fraud-graphs/), [TigerGraph fraud graph](https://www.tigergraph.com/glossary/fraud-detection-with-graph/), [NVIDIA GNN fraud blueprint](https://developer.nvidia.com/blog/supercharging-fraud-detection-in-financial-services-with-graph-neural-networks/), [Senzing entity resolution for fraud](https://senzing.com/risk-fraud-detection/).
- Established: explainability is not decoration. Fraud systems need investigator-facing reasons because false positives, compliance, and user trust are central risks; this supports the app's deterministic signal explanations and should push confidence to model agreement, not just tool coverage.

### Round 3: Hackathon / Foundry Winning Strategy

- Official rules require a working project, max 5-minute demo video, public GitHub repo, architecture diagram, and judging on: 20% Accuracy & Relevance, 20% Reasoning & Multi-step Thinking, 15% Creativity & Originality, 15% UX & Presentation, 20% Reliability & Safety, 10% Community vote.
  - Sources accessed 2026-06-12: [Agents League registration](https://info.microsoft.com/Agents-League-Hackathon-Registration.html), [official rules](https://aka.ms/AgentsLeagueRules).
- Microsoft Foundry fit is strong: Foundry Agent Service is a managed platform for building, deploying, and scaling agents; Azure AI Search tools ground agent answers with inline citations; Foundry IQ provides agentic retrieval with citations; Foundry observability includes evaluation, monitoring, tracing, and agent-specific tool-call accuracy/task-completion evaluators.
  - Sources accessed 2026-06-12: [Foundry Agent Service overview](https://learn.microsoft.com/en-us/azure/foundry/agents/overview), [Azure AI Search tool for Foundry agents](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/tools/ai-search), [Foundry IQ](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/what-is-foundry-iq), [Foundry observability](https://learn.microsoft.com/en-us/azure/foundry/concepts/observability).
- Safety opportunity: Prompt Shields and AI Red Teaming Agent map directly to the app's untrusted-evidence threat model. They are also judge-visible proof for the 20% Reliability & Safety criterion.
  - Sources accessed 2026-06-12: [Prompt Shields](https://learn.microsoft.com/en-us/azure/ai-services/content-safety/concepts/jailbreak-detection), [AI Red Teaming Agent](https://learn.microsoft.com/en-us/azure/foundry/concepts/ai-red-teaming-agent).

## Decision Implications

- Keep the core pitch: "fraud hides in relationships between evidence" is now well-supported by both scam evolution and fraud-detection architecture research.
- Demo should emphasize four beats: real victim channels (text/WhatsApp/voice), agent collaboration, graph ring reveal, and deterministic evidence-backed safety.
- Highest-impact product additions before/after submission: report-vs-check triage, task-scam/crypto/app-balance signals, stronger Foundry IQ/Azure Search grounding, confidence based on agreement, and a WhatsApp-forwardable reporting roadmap.
- For winning, do not dilute the demo with many features. Show one polished investigation where Foundry agents, graph intelligence, voice, citations, fallback, and safety all visibly work.
