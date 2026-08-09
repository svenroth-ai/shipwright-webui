# Architecture Brief: triage-filter-styling

## The problem
The Triage tab's filter chips and the Task Board's Preview button don't visually match the app's established button chrome, and Preview renders in a mode ("All projects") where it has no single project to act on.

## What would newly, permanently exist
Nothing. This changes CSS classes on two existing components and adds one conditional render check to a third. No new mechanism, service, credential, or data.
