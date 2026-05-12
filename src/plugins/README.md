# `plugins/`

Optional, vertically-sliced extensions: telemedicine, billing, lab-integration, sms-reminders, insurance-claims. Each plugin is self-contained and may be enabled per organization.

## Dependency rule

`plugins → common, infrastructure, builder, and the public surface of core only.` A plugin may import from `@core/<module>/*.module.ts` or `@core/<module>/*.public.ts`; importing internal core files is forbidden. Plugins must never import from each other. Enforced by `eslint.config.mjs`.

## Layout (per plugin)

```
plugins/<name>/
├── <name>.module.ts
├── <name>.manifest.ts        # name, version, requiredFeatures, subscribed events
├── listeners/                # subscribe to domain events via EventBus
├── services/
├── controllers/              # endpoints prefixed /api/plugins/<name>
└── dto/
```

## Manifest contract (sketch)

```ts
export interface PluginManifest {
  name: string;
  version: string;
  requiredFeatures?: string[];
  subscribedEvents?: string[];
}
```

Will be formalized when the first plugin is built.

## Status

No plugins exist yet. Folder is in place so the boundary rule is active before the first plugin lands.
