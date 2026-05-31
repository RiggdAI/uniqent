<!-- GENERATED FILE — edit packages/spec then run `pnpm --filter @uniqent/spec gen`. -->

# The `.uniqent` bundle format

Spec version: **0.1**. Dedicated to the public domain under CC0 (see `LICENSE-SPEC`).

A `.uniqent` file is a gzipped tar of a bundle directory. The schemas below are generated from
the zod definitions in `packages/spec` — the source of truth. The machine-readable JSON Schema is
at [`packages/spec/schema/uniqent.schema.json`](../packages/spec/schema/uniqent.schema.json).

## Bundle layout

```
<bundle>/
├── uniqent.json             # manifest (REQUIRED)
├── signature.json           # detached Ed25519 signature (added by `sign`)
├── identity/                # persona.md (+ optional policies.md)
├── memory/                  # profile.json, facts.jsonl, episodic.jsonl
├── skills/<name>/SKILL.md   # cross-agent skills
├── mcp/servers.json         # MCP server declarations
├── tools/tools.json         # native tool enablement
├── tasks/*.json             # automations
├── channels/channels.json   # messaging surfaces
└── setup/runtime.json       # model/provider prefs, defaults
```

## Schemas

- [`Manifest`](#manifest) — uniqent.json — The bundle manifest.
- [`CredentialRequirement`](#credentialrequirement) — uniqent.json (credentials[]) — The install contract: what a bundle needs and what consumes it. Never a value.
- [`PermissionScope`](#permissionscope) — uniqent.json (permissions) — The permission sheet shown before any write.
- [`McpServersFile`](#mcpserversfile) — mcp/servers.json — MCP server declarations (transport, auth type, tool allowlist, credentialRef).
- [`MemoryItem`](#memoryitem) — memory/facts.jsonl, memory/episodic.jsonl — One memory line (fact/decision/preference/milestone/episodic).
- [`MemoryProfile`](#memoryprofile) — memory/profile.json — Structured "who the user/agent is".
- [`ChannelsFile`](#channelsfile) — channels/channels.json — Messaging surfaces with credentialRefs.
- [`ToolsFile`](#toolsfile) — tools/tools.json — Native/built-in tool enablement.
- [`Task`](#task) — tasks/*.json — An automation: trigger + action.
- [`RuntimeConfig`](#runtimeconfig) — setup/runtime.json — Model/provider prefs, defaults, autonomy, tool allowlist.
- [`Signature`](#signature) — signature.json — Detached Ed25519 signature over a canonical digest.

### Manifest

*File:* `uniqent.json`

The bundle manifest.

```json
{
  "type": "object",
  "properties": {
    "specVersion": {
      "type": "string",
      "const": "0.1"
    },
    "name": {
      "type": "string",
      "pattern": "^[a-z0-9][a-z0-9-]*$"
    },
    "displayName": {
      "type": "string",
      "minLength": 1
    },
    "version": {
      "type": "string",
      "pattern": "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$"
    },
    "description": {
      "type": "string"
    },
    "author": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1
        },
        "handle": {
          "type": "string"
        },
        "url": {
          "type": "string",
          "format": "uri"
        },
        "pubkey": {
          "type": "string"
        }
      },
      "required": [
        "name"
      ],
      "additionalProperties": false
    },
    "license": {
      "type": "string",
      "minLength": 1
    },
    "tags": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "components": {
      "type": "object",
      "properties": {
        "identity": {
          "type": "boolean"
        },
        "memory": {
          "type": "object",
          "properties": {
            "facts": {
              "type": "integer",
              "minimum": 0
            },
            "episodic": {
              "type": "integer",
              "minimum": 0
            },
            "hasProfile": {
              "type": "boolean"
            }
          },
          "required": [
            "facts",
            "episodic",
            "hasProfile"
          ],
          "additionalProperties": false
        },
        "skills": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "mcp": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "tools": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "tasks": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "channels": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "identity",
        "memory",
        "skills",
        "mcp",
        "tools",
        "tasks",
        "channels"
      ],
      "additionalProperties": false
    },
    "credentials": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "ref": {
            "type": "string",
            "minLength": 1
          },
          "label": {
            "type": "string",
            "minLength": 1
          },
          "type": {
            "type": "string",
            "enum": [
              "apiKey",
              "bearer",
              "header",
              "oauth2",
              "envVar"
            ]
          },
          "consumedBy": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "required": {
            "type": "boolean"
          },
          "help": {
            "type": "string"
          },
          "oauth": {
            "type": "object",
            "properties": {
              "authorizationUrl": {
                "type": "string",
                "format": "uri"
              },
              "scopes": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "note": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "required": [
          "ref",
          "label",
          "type",
          "consumedBy",
          "required"
        ],
        "additionalProperties": false
      }
    },
    "permissions": {
      "type": "object",
      "properties": {
        "filesystem": {
          "type": "object",
          "properties": {
            "read": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "write": {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          },
          "required": [
            "read",
            "write"
          ],
          "additionalProperties": false
        },
        "network": {
          "type": "object",
          "properties": {
            "endpoints": {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          },
          "required": [
            "endpoints"
          ],
          "additionalProperties": false
        },
        "autonomy": {
          "type": "string",
          "enum": [
            "manual",
            "suggest",
            "auto"
          ]
        },
        "spawnsProcesses": {
          "type": "boolean"
        },
        "notes": {
          "type": "string"
        }
      },
      "required": [
        "filesystem",
        "network",
        "autonomy",
        "spawnsProcesses"
      ],
      "additionalProperties": false
    },
    "compatibility": {
      "type": "object",
      "properties": {
        "targets": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "targets"
      ],
      "additionalProperties": false
    },
    "signatureRef": {
      "type": "string",
      "const": "signature.json"
    }
  },
  "required": [
    "specVersion",
    "name",
    "displayName",
    "version",
    "description",
    "author",
    "license",
    "tags",
    "components",
    "credentials",
    "permissions",
    "compatibility"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### CredentialRequirement

*File:* `uniqent.json (credentials[])`

The install contract: what a bundle needs and what consumes it. Never a value.

```json
{
  "type": "object",
  "properties": {
    "ref": {
      "type": "string",
      "minLength": 1
    },
    "label": {
      "type": "string",
      "minLength": 1
    },
    "type": {
      "type": "string",
      "enum": [
        "apiKey",
        "bearer",
        "header",
        "oauth2",
        "envVar"
      ]
    },
    "consumedBy": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "required": {
      "type": "boolean"
    },
    "help": {
      "type": "string"
    },
    "oauth": {
      "type": "object",
      "properties": {
        "authorizationUrl": {
          "type": "string",
          "format": "uri"
        },
        "scopes": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "note": {
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  "required": [
    "ref",
    "label",
    "type",
    "consumedBy",
    "required"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### PermissionScope

*File:* `uniqent.json (permissions)`

The permission sheet shown before any write.

```json
{
  "type": "object",
  "properties": {
    "filesystem": {
      "type": "object",
      "properties": {
        "read": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "write": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "read",
        "write"
      ],
      "additionalProperties": false
    },
    "network": {
      "type": "object",
      "properties": {
        "endpoints": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "endpoints"
      ],
      "additionalProperties": false
    },
    "autonomy": {
      "type": "string",
      "enum": [
        "manual",
        "suggest",
        "auto"
      ]
    },
    "spawnsProcesses": {
      "type": "boolean"
    },
    "notes": {
      "type": "string"
    }
  },
  "required": [
    "filesystem",
    "network",
    "autonomy",
    "spawnsProcesses"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### McpServersFile

*File:* `mcp/servers.json`

MCP server declarations (transport, auth type, tool allowlist, credentialRef).

```json
{
  "type": "object",
  "properties": {
    "servers": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1
          },
          "transport": {
            "type": "string",
            "enum": [
              "streamable-http",
              "sse",
              "stdio"
            ]
          },
          "url": {
            "type": "string",
            "format": "uri"
          },
          "command": {
            "type": "string"
          },
          "args": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "env": {
            "type": "object",
            "additionalProperties": {
              "type": "string"
            }
          },
          "auth": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "none",
                  "bearer",
                  "header",
                  "oauth2"
                ]
              },
              "credentialRef": {
                "type": "string"
              },
              "headerName": {
                "type": "string"
              }
            },
            "required": [
              "type"
            ],
            "additionalProperties": false
          },
          "tools": {
            "type": "object",
            "properties": {
              "include": {
                "anyOf": [
                  {
                    "type": "string",
                    "const": "all"
                  },
                  {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  }
                ]
              }
            },
            "required": [
              "include"
            ],
            "additionalProperties": false
          },
          "description": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "transport",
          "auth",
          "tools"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "servers"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### MemoryItem

*File:* `memory/facts.jsonl, memory/episodic.jsonl`

One memory line (fact/decision/preference/milestone/episodic).

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1
    },
    "kind": {
      "type": "string",
      "enum": [
        "fact",
        "decision",
        "preference",
        "milestone",
        "episodic"
      ]
    },
    "text": {
      "type": "string"
    },
    "source": {
      "type": "string"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "importance": {
      "type": "number",
      "minimum": 0,
      "maximum": 1
    },
    "visibility": {
      "type": "string",
      "enum": [
        "shareable",
        "personal"
      ],
      "default": "shareable"
    },
    "tags": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "id",
    "kind",
    "text",
    "createdAt"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### MemoryProfile

*File:* `memory/profile.json`

Structured "who the user/agent is".

```json
{
  "type": "object",
  "additionalProperties": {},
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### ChannelsFile

*File:* `channels/channels.json`

Messaging surfaces with credentialRefs.

```json
{
  "type": "object",
  "properties": {
    "channels": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1
          },
          "kind": {
            "type": "string",
            "enum": [
              "telegram",
              "discord",
              "slack",
              "whatsapp",
              "sms",
              "email",
              "webhook"
            ]
          },
          "credentialRef": {
            "type": "string"
          },
          "config": {
            "type": "object",
            "additionalProperties": {}
          },
          "description": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "kind"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "channels"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### ToolsFile

*File:* `tools/tools.json`

Native/built-in tool enablement.

```json
{
  "type": "object",
  "properties": {
    "tools": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1
          },
          "enabled": {
            "type": "boolean"
          },
          "config": {
            "type": "object",
            "additionalProperties": {}
          },
          "description": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "enabled"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "tools"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### Task

*File:* `tasks/*.json`

An automation: trigger + action.

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1
    },
    "name": {
      "type": "string",
      "minLength": 1
    },
    "trigger": {
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "const": "schedule"
            },
            "cron": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "type",
            "cron"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "const": "event"
            },
            "event": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "type",
            "event"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "const": "manual"
            }
          },
          "required": [
            "type"
          ],
          "additionalProperties": false
        }
      ]
    },
    "action": {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "minLength": 1
        },
        "prompt": {
          "type": "string"
        },
        "params": {
          "type": "object",
          "additionalProperties": {}
        }
      },
      "required": [
        "kind"
      ],
      "additionalProperties": false
    },
    "enabled": {
      "type": "boolean"
    },
    "description": {
      "type": "string"
    }
  },
  "required": [
    "id",
    "name",
    "trigger",
    "action",
    "enabled"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### RuntimeConfig

*File:* `setup/runtime.json`

Model/provider prefs, defaults, autonomy, tool allowlist.

```json
{
  "type": "object",
  "properties": {
    "model": {
      "type": "object",
      "properties": {
        "provider": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "additionalProperties": false
    },
    "autonomy": {
      "type": "string",
      "enum": [
        "manual",
        "suggest",
        "auto"
      ]
    },
    "toolAllowlist": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "defaults": {
      "type": "object",
      "additionalProperties": {}
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

### Signature

*File:* `signature.json`

Detached Ed25519 signature over a canonical digest.

```json
{
  "type": "object",
  "properties": {
    "algorithm": {
      "type": "string",
      "const": "ed25519"
    },
    "publicKey": {
      "type": "string",
      "minLength": 1
    },
    "digestAlgorithm": {
      "type": "string",
      "const": "sha256"
    },
    "digest": {
      "type": "string",
      "minLength": 1
    },
    "signature": {
      "type": "string",
      "minLength": 1
    },
    "signedAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "required": [
    "algorithm",
    "publicKey",
    "digestAlgorithm",
    "digest",
    "signature",
    "signedAt"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```
