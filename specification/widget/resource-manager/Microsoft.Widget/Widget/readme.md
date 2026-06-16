# Widget

> see https://aka.ms/autorest

This is the AutoRest configuration file for the Widget Resource Provider.

## Configuration

### Basic Information

This is a TypeSpec-based project. The readme file is used to configure the default tag and reference the generated swagger files.
This configuration is primarily used for documentation generation and swagger API view generation.
SDK code generation uses the native TypeSpec configuration specified in the tspconfig.yaml file.

```yaml
openapi-type: arm
openapi-subtype: rpaas
tag: package-preview-2024-10-01
```

### Tag: package-preview-2024-10-01

These settings apply only when `--tag=package-preview-2024-10-01` is specified on the command line.

```yaml $(tag) == 'package-preview-2024-10-01'
input-file:
  - preview/2024-10-01-preview/widget.json
suppressions:
  - code: PathContainsResourceType
  - code: PathResourceProviderMatchNamespace
```

### Tag: package-2021-11-01

These settings apply only when `--tag=package-2021-11-01` is specified on the command line.

```yaml $(tag) == 'package-2021-11-01'
input-file:
  - stable/2021-11-01/widget.json
suppressions:
  - code: PathContainsResourceType
  - code: PathResourceProviderMatchNamespace
```

---
