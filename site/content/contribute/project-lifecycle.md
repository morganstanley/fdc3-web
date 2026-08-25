---
category: Contribute
order: 0
title: Project Lifecycle
---

Morgan Stanley projects are categorized by maturity and activity according to the Morgan Stanley Open Source Project Lifecycle. The lifecycle is designed to help users easily determine which projects are appropriate for their use and to give Morgan Stanley maintainers a road map for progressing their projects. The lifecycle includes three states:

- Incubating for newly created projects that are not yet fit for consumption or are missing required setup and configuration;
- Active for mature, active projects; and
- Archived for projects that are no longer actively maintained.

## Incubating Projects

![Lifecycle Incubating](https://badgen.net/badge/Lifecycle/Incubating/yellow)

When a project is first created or contributed, it is automatically placed in the Incubating stage. An Incubating project is under active early development and typically has not made its first major release. During incubation, projects typically experiment heavily with technical designs, standardize their build and release processes, develop their collaborative processes, and work to grow their developer community. Incubating projects are usually not focused on support of backward compatibility.

Incubating projects will display the Incubating badge in the README.

`![Lifecycle Incubating](https://badgen.net/badge/Lifecycle/Incubating/yellow)`

## Active Projects

![Lifecycle Active](https://badgen.net/badge/Lifecycle/Active/green)

Active projects are mature open source projects with active communities. They follow industry standard practices for collaborative software development, have mature and well-documented build and release processes, and maintain thorough documentation.

Projects that are active have been recognized as software that is suitable for production use. Virtually all Morgan Stanley open source projects expect to strive towards, and ultimately attain, Active status. This indicates to potential consumers that the project has reached a level of maturity, both functional and non-functional, that is suitable for production use.

Except for where agreed with maintainers, all existing non-archived projects will be categorized as Active. For any missing any of the below checklist, there will be hygiene follow-up.

### Checklist:

**Development Process** - The project adopts standards of distributed software development, including but not limited to:

- branch protection
- continuous integration ("CI") and continuous delivery ("CD") where applicable

**Build & Release** - The project code/documentation release process automated or at least well documented. If code is published, publicly redistributed release binaries should be listed or referred to in the documentation.

**Documentation** -

- The README must exist and include or reference up to date:
- End user documentation, including description of the software, feature overview, installation and configuration instructions.
- Developer documentation, including links to other external systems (further docs, wiki, CI & validation tools, package repository, change log, etc)
- Where possible badges
- Sample code explaining how to use the project, library, standard, SDK, etc.

**License** - must be present and agreed upon with Legal. Project must not have any dependencies which effectively restrict how the project may be distributed or deployed and must not depend on any proprietary third-party components for their core functionality.

**Compliance** - The appropriate license text is included in each source file's header as instructed by Legal.

**Versioning** - Project is production grade and ready for consumption.

<br />

Active projects will display the Active badge in the README once activate is approved.

`![Lifecycle Active(https://badgen.net/badge/Lifecycle/Active/green)`

## Archived Projects

![Lifecycle Archived](https://badgen.net/badge/Lifecycle/Archived/grey)

Projects are Archived when they are no longer actively developed, for any reason. Archived projects may no longer actively address new issues, including security vulnerabilities. Their code and documentation remain available because they may still be useful, but should be used by others with caution due to the lack of being updated. The project will be changed to Archived in GitHub.

Projects that have become inactive become eligible for archiving, where "inactivity" is defined as having had no activity (release, publication, commit, PR, issue updates, etc.) in the last 180 days (6 months). Alternatively, the Open Source Program Office, project maintainers or management can request to trigger the archiving process for a project.

Maintainers of projects meeting this criteria will be notified of the Open Source Program Office (OSPO) review and invited to attend the review or to otherwise communicate their plan for remediation. The review will make the decision as to what action to take for this project and the decision will be owned by the OSPO. If the determination is to archive the project, then the project will be archived within at most two months. If the decision is made to not archive the project, and no remediation is performed then the project will end up being re-evaluated in the subsequent reviews until either the project is remediated or the decision is made to archive.

Project maintainers can make a request to the Open Source Program Office to have a project flipped back from Unarchived to Active.

An archived project will have the Active badge updated to Archived in the README and be archived on GitHub by an organization owner.

`![Lifecycle Archived(https://badgen.net/badge/Lifecycle/Archived/grey)`

Any currently archived project will be unarchived to have the readme updated with the archived badge and then archived again.

## Deleted Projects

Deleting open source projects is bad community practice. In the event that there is significant reason to have a project not just be archived but removed, the project will most likely be changed form public to private rather than deleted. Any such request will be addressed individually by the Open Source Project Office. This should not be a normal practice. At the time of open sourcing the project, a commitment and decision was made to make it open source. Simply hiding/deleting the project doesn't remove it from other mirrors or from anyone that has copied/forked your project.
