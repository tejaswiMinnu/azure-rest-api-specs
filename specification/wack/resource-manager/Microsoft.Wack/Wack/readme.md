# Wack

> see https://aka.ms/autorest

This is the AutoRest configuration file for Wack.

## Configuration

### Basic Information

```yaml
openapi-type: arm
openapi-subtype: rpaas
tag: package-2024-01-01-preview
```

### Tag: package-2024-01-01-preview

These settings apply only when `--tag=package-2024-01-01-preview` is specified on the command line.

```yaml $(tag) == 'package-2024-01-01-preview'
input-file:
  - preview/2024-01-01-preview/wack.json
```

---
