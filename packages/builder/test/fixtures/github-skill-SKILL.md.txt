---
name: ios-security-wizard
description: "Use when doing iOS security: Mach-O, dyld, entitlements."
version: 1.1.0
author: savagedamage
license: MIT
platforms: [linux, macos]
metadata:
  hermes:
    tags: [iOS, Security, Mach-O, dyld, Entitlements, Frida, Objection, XPC, PAC, IPA, Reverse Engineering, Instrumentation]
    category: security
---

# iOS Security Wizard — Skill

**Purpose:** Become a deep iOS security operator: static Mach-O/dyld analysis, entitlement and provisioning profile auditing, gadget-mode dynamic instrumentation (no root), XPC/URL scheme/extension attack surface mapping, pointer authentication (PAC) bypass research, and IPA risk-weighted delta analysis. This skill encodes the tooling, workflows, and methodology to operate at that level on iOS devices you own or have explicit authorization to test.

**Scope:** iOS app security, Mach-O static analysis, dyld shared cache extraction, entitlement/provisioning audit, ObjC/Swift metadata recovery, hardened runtime flags, Frida/Objection gadget-mode instrumentation, dyld_interpose tracing, XPC service enumeration, launchd job inspection, IPA delta risk analysis, probe planning for XPC/URL schemes/extensions, device baseline drift detection (mobilegestalt/sysctl), PAC bypass research, crypto weakness scanning, jailbreak/compromise assessment, unified reporting.

**Unique Angle:** No root = all dynamic analysis is gadget-mode or debugserver; focus on entitlement bypass, XPC hardening, pointer authentication (PAC) bypasses. Public iOS triage is mostly "run MobSF" — this fills the tooling gap: stdlib Mach-O parser, delta tool, drift baseline.

**Corpus:** This skill is a complete corpus — INDEX.md maps everything; README.md is the human entry point; AGENT-GUIDE.md is the AI operating manual with the decision tree, evidence schema, and output interpretation rules. Load AGENT-GUIDE.md before executing any iOS security task.

**Public corpus:** https://github.com/savagedamage/ios-security-wizard — the maintained repository (same content, versioned releases). Direct sibling of `android-security-wizard`.

## Static Analysis Layer

### Mach-O Parser (stdlib only)
- Parse Mach-O headers, load commands, segments, sections, symbols, code signatures
- Extract: LC_CODE_SIGNATURE, LC_DYLD_INFO, LC_DYLD_EXPORTS_TRIE, LC_DYLD_CHAINED_FIXUPS
- Identify: PIE, stack canaries, ARC, hardened runtime flags, pointer authentication (PAC) markers
- No external deps — pure Python stdlib for portability

### dyld Shared Cache Extraction
- Locate and parse dyld shared cache (macOS/iOS)
- Extract individual dylibs from shared cache for analysis
- Map: address → symbol → library for cross-referencing
- Support: iOS 14+ cache formats (AOT, split cache)

### Entitlements & Provisioning Profile Audit
- Parse embedded.mobileprovision (CMS/SignedData)
- Extract: application-identifier, keychain-access-groups, com.apple.developer.* entitlements
- Validate: team ID, expiration, provisioned devices, entitlement consistency
- Hardened runtime flags: com.apple.security.cs.* flags audit
- Detect: over-privileged entitlements, missing restrictions, wildcard keychain groups

### ObjC/Swift Metadata Recovery
- Class/method/protocol extraction from __objc_* sections
- Swift metadata: type metadata, protocol conformances, witness tables
- Selector/method name recovery for dynamic call graph
- Property/ivar layout reconstruction

## Dynamic Analysis Layer (Gadget-Mode Only)

### Frida/Objection on iOS (Gadget Mode)
- Frida-gadget injection via IPA re-signing (no jailbreak)
- Objection exploration: bundle, keychain, filesystem, IPC
- Custom Frida scripts for: method hooking, crypto tracing, XPC interception
- Stalker-based coverage-guided tracing for unknown code paths

### dyld_interpose Tracing
- Interpose dyld APIs: dyld_image_path_containing_address, dyld_get_image_name
- Trace dynamic library loads, symbol resolution, chained fixup application
- Correlate with static shared cache map

### XPC Service Enumeration
- Enumerate XPC services from: launchd, app bundles, system directories
- Parse: Info.plist XPC service definitions, launchd plists
- Identify: privileged helpers, mach service bootstrap names, audit token handling
- Test: XPC connection hijacking, message fuzzing, reply validation

### launchd Job Inspection
- Parse: /Library/LaunchDaemons, /Library/LaunchAgents, ~/Library/LaunchAgents
- Extract: ProgramArguments, RunAtLoad, KeepAlive, StandardErrorPath
- Identify: suspicious persistence, unsigned binaries, excessive privileges
- Correlate with running processes (launchctl list)

## Pentest Suite

### ipa_diff.py — Risk-Weighted Delta
- Input: two .ipa files (baseline + target)
- Extract: Mach-O binaries, entitlements, provisioning profiles, Info.plist, resources
- Diff: binary changes (symbol add/remove, code signature changes), entitlement diff, provisioning diff, resource diff
- Risk weighting:
  - CRITICAL: new entitlements, removed hardened runtime flags, code signature changes
  - HIGH: new XPC services, new URL schemes, new extensions
  - MEDIUM: new symbols, changed logic in security-critical paths
  - LOW: resource changes, version bumps
- Output: SARIF + markdown report with evidence

### probe_plan.py — XPC/URL Schemes/Extensions Attack Surface
- Input: extracted app bundle or IPA
- Enumerate: CFBundleURLTypes, NSExtension, XPC service definitions
- Generate: Frida/Objection probe scripts per entry point
- Prioritize: exported services, privileged helpers, custom URL schemes
- Output: executable probe plan with reproduction steps

### device_baseline.py — MobileGestalt/Sysctl Drift
- Capture: mobilegestalt keys (hardware, OS, build, device identity)
- Capture: security-relevant sysctls (kern.*, security.*, vm.*, machdep.*)
- Baseline: known-good device snapshot (JSON)
- Drift detection: compare current → baseline, flag anomalies
- Alert: unexpected kernel params, modified boot args, PAC configuration changes
- Use case: device integrity verification, jailbreak detection bypass validation

## Tooling Gap Filled
| Gap | Public State | This Skill |
|-----|--------------|------------|
| Mach-O parser | ida/ghidra/MobSF (heavy) | stdlib-only, scriptable |
| IPA delta | manual diff | risk-weighted, SARIF |
| Device baseline | none | mobilegestalt+sysctl drift |
| XPC enum | Frida scripts only | structured enumeration + probe gen |
| PAC bypass research | scattered blogs | consolidated methodology |
| Gadget-mode workflow | fragmented docs | end-to-end pipeline |

## Workflows

### 1. Static Triage (IPA → Report)
```bash
# Extract IPA
unzip -q app.ipa -d /tmp/app

# Run static analyzers
python3 static/macho_parser.py /tmp/app/Payload/App.app/App
python3 static/entitlements.py /tmp/app/Payload/App.app/embedded.mobileprovision
python3 static/objc_swift.py /tmp/app/Payload/App.app/App
python3 static/dyld_cache.py --info /path/to/dyld_shared_cache_arm64
```

### 2. Gadget-Mode Dynamic Setup
```bash
# Re-sign with Frida gadget (requires Apple Developer cert)
objection patchipa -s app.ipa -o app-gadget.ipa
# Install via altstore/sideloadly
# Connect Frida
frida -U -f com.target.app --no-pause
```

### 3. IPA Delta Analysis
```bash
python3 pentest/ipa_diff.py baseline.ipa target.ipa --output delta-report/
# Review delta-report/delta.sarif + delta-report/delta.md
```

### 4. XPC/Extension Probe Generation
```bash
python3 pentest/probe_plan.py /tmp/app/Payload/App.app --output probes/
# Run generated probes against live device
```

### 5. Device Baseline & Drift
```bash
# Baseline (known-good)
python3 pentest/device_baseline.py --capture --baseline baseline.json
# Drift check
python3 pentest/device_baseline.py --check --baseline baseline.json
```

## Key Files & Scripts

```
ios-security-wizard/
├── ios-wizard                   # unified CLI entry point
├── SKILL.md                     # this skill definition
├── INDEX.md                     # corpus map (start here)
├── README.md                    # human quick start
├── AGENT-GUIDE.md               # AI operating manual (load first for tasks)
├── GLOSSARY.md                  # terminology
├── CHANGELOG.md                 # version history
├── LICENSE                      # MIT + usage notice
├── static/
│   ├── macho_parser.py          # stdlib Mach-O parser
│   ├── ipa_structure.py         # IPA/bundle anatomy analyzer
│   ├── dyld_cache.py            # dyld shared cache extractor
│   ├── entitlements.py          # provisioning/entitlement audit
│   ├── objc_swift.py            # ObjC/Swift metadata recovery (full 64-bit runtime)
│   ├── hardened_runtime.py      # flag audit
│   └── crypto_scan.py           # crypto API + weakness scanner
├── dynamic/
│   ├── gadget_frida.py          # Frida gadget injection helpers
│   ├── dyld_interpose.py        # dyld API interposition tracing
│   ├── xpc_enum.py              # XPC service enumeration
│   ├── launchd_inspect.py       # launchd job inspection
│   └── jailbreak_check.py       # multi-indicator compromise assessment
├── pentest/
│   ├── ipa_diff.py              # risk-weighted IPA delta (SARIF)
│   ├── probe_plan.py            # XPC/URL/extension probe gen
│   ├── device_baseline.py       # mobilegestalt/sysctl drift
│   └── report_gen.py            # unified evidence-schema reporting
├── scripts/
│   ├── re-sign_gadget.sh        # IPA re-signing with gadget
│   ├── extract_dyld_cache.sh    # macOS dyld cache extraction
│   └── baseline_capture.sh      # device baseline capture
├── test/
│   └── macho_fixture.py         # minimal valid Mach-O builder
├── test_fixtures.py             # component test suite (15 tests)
├── references/                  # knowledge base (12 topics)
│   ├── macho_format.md          # Mach-O binary format
│   ├── ipa_structure.md         # IPA/app bundle anatomy
│   ├── entitlements_ref.md      # entitlement keys reference
│   ├── crypto_analysis.md       # crypto APIs and weaknesses
│   ├── network_security.md      # ATS, pinning, traffic analysis
│   ├── data_storage.md          # keychain, defaults, file protection
│   ├── xpc_services.md          # XPC architecture and enumeration
│   ├── jailbreak_detection.md   # detection + bypass methods
│   ├── anti_tampering.md        # anti-debugging, integrity checks
│   ├── frida_scripts.md         # runnable Frida script library
│   ├── pac_bypass.md            # PAC techniques
│   └── masvs_mapping.md         # OWASP MASVS/MSTG mapping
└── templates/
    ├── pentest_report.md        # report structure template
    └── entitlements_plist.xml   # secure entitlements baseline
```

## Verification

Run the component test suite:
```bash
cd ~/.hermes/skills/security/ios-security-wizard
./ios-wizard test
```

Expected output: `Results: 15 passed, 0 failed` (builds real Mach-O fixtures and exercises parsers, scanners, and report generation end-to-end).

## Prerequisites
- macOS host for: dyld shared cache extraction, IPA re-signing, Xcode toolchain
- Linux host for: static analysis, Frida server (remote device)
- Apple Developer Program membership (for gadget re-signing)
- Frida 16+, Objection latest
- Python 3.11+ (stdlib only for core parsers)

## Safety & Authorization
- **Only test devices you own or have explicit written authorization for**
- Gadget-mode requires re-signing — valid Apple Developer cert needed
- No jailbreak, no root — all dynamic via gadget/debugserver
- PAC bypass research: document only, do not weaponize
- Respect Apple's security model; report findings responsibly

## Integration
- Complements: android-security-wizard (mobile security pair)
- Feeds: threat-intel-processing (IOCs from IPA analysis)
- Consumes: web-recon-scanning (C2 infrastructure from dynamic traces)
- Outputs: SARIF for CI/CD integration, markdown for human review

## Quick Reference

| Task | Entry Point |
|------|-------------|
| Full static triage | `./ios-wizard triage <target.ipa|App.app> -o report/` |
| Parse Mach-O | `./ios-wizard static macho <binary>` |
| Analyze IPA structure | `./ios-wizard static ipa <target.ipa|App.app>` |
| Audit entitlements | `./ios-wizard static entitlements <.mobileprovision>` |
| Extract dyld cache | `./ios-wizard static dyld --info <cache>` |
| Recover ObjC/Swift | `./ios-wizard static objc <binary>` |
| Scan crypto | `./ios-wizard static crypto <binary>` |
| Inject Frida gadget | `./scripts/re-sign_gadget.sh <.ipa>` |
| Trace dyld interpose | `./ios-wizard dynamic interpose --frida-script out.js` |
| Enumerate XPC | `./ios-wizard dynamic xpc <app_bundle>` |
| Inspect launchd | `./ios-wizard dynamic launchd --audit` |
| Jailbreak check | `./ios-wizard dynamic jailbreak` |
| IPA delta | `./ios-wizard pentest diff <old.ipa> <new.ipa>` |
| Generate probes | `./ios-wizard pentest probes <app_bundle>` |
| Device baseline | `./ios-wizard pentest baseline --capture` |
| Check drift | `./ios-wizard pentest baseline --check --baseline <file>` |
| Unified report | `./ios-wizard pentest report <findings.json...> -o report.md` |
| Run tests | `./ios-wizard test` |

---
*Direct sibling of android-security-wizard — same philosophy, iOS constraints.*
