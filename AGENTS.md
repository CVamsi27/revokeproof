# Revokeproof operating rules

- This is a standalone project. Keep dependencies, scripts, tests and examples in this folder; do not import sibling projects or lab tooling at runtime.
- Use only synthetic fixtures and disposable resources. Never load production credentials, databases, queues or application boot files.
- Deployment files are read as data. Application smoke commands and rollout contracts execute only in constrained disposable containers without engine socket, host source mounts or host environment forwarding.
- Browser examples target only their explicitly started synthetic loopback fixture. Do not probe external applications by default.
- Missing observations, dead controls, timeouts, unsupported cases and failed cleanup/prerequisites must never become passing results.
- Use OrbStack for local container execution, with the existing compatible-client overrides. No global cleanup.
- Run `npm run check`, `npm run pack:check` and relevant real integration before reporting completion. Record blocked gates separately.
- Do not commit local artifacts or secrets. No publication, outreach, production actions or adoption claims without measured evidence and authorization.

Public GitHub creation and pushes for this alpha are explicitly authorized by the user on 5 November 2026 after readiness checks. Registry publication, outreach, production actions and global cleanup still require their own authorization.
