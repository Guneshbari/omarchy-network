## Description

- **What does this PR change?**: 
- **Why is the change needed?**: 

---

## Type of Change

- [ ] Bug fix
- [ ] Feature
- [ ] UI/UX change
- [ ] Performance improvement
- [ ] Security/reliability improvement
- [ ] Documentation
- [ ] Refactor

---

## Validation

Refer to [CONTRIBUTING.md](CONTRIBUTING.md) for detailed validation guidelines.

- [ ] I ran `omarchy plugin validate .` successfully.
- [ ] I ran `qmllint` against every modified QML file.
- [ ] I tested the actual behavior affected by this change.
- [ ] I tested plugin enable/disable behavior when relevant.
- [ ] I tested shell restart/reload behavior when relevant.
- [ ] I tested plugin removal/cleanup behavior when relevant.

---

## Security & Safety

- [ ] I did not add passwords, tokens, API keys, private keys, Wi-Fi credentials, or other secrets.
- [ ] I did not expose secrets through process arguments.
- [ ] I did not add unnecessary privilege escalation or require the entire plugin/test suite to run as root.
- [ ] I did not use broad process termination such as `pkill` or `killall` where targeted process identification is possible.
- [ ] I verified that processes/resources created by this change cannot accidentally affect unrelated user processes or network connections.
- [ ] I did not start a second Quickshell/Omarchy shell process.
- [ ] I documented any new external dependency, service, installer, privilege requirement, or remote build mechanism.

---

## Network Changes

*Complete this section when the PR changes networking behavior.*

- [ ] I tested the affected NetworkManager behavior.
- [ ] I verified that unrelated network connections are not intentionally disrupted.
- [ ] I tested cleanup/teardown when the change creates processes, interfaces, or temporary resources.
- [ ] I documented any known limitations or recovery behavior.

---

## UI Changes

*Complete this section when the PR changes the UI.*

- [ ] I tested opening and closing the affected UI.
- [ ] I tested Escape/keyboard behavior when applicable.
- [ ] I tested the affected interaction through the normal Omarchy shell.
- [ ] I included before/after screenshots for substantial visual changes.

---

## Dependencies & Documentation

- [ ] I updated documentation if user-facing behavior changed.
- [ ] I documented new dependencies and setup requirements.
- [ ] I documented any new privilege or service requirement.
- [ ] I kept this PR focused and excluded unrelated changes.

---

## Screenshots

*For substantial UI changes, add before/after screenshots below.*

---

## Additional Notes

*Mention anything reviewers should know, including limitations, untested scenarios, migration considerations, or known issues.*
