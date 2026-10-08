# Rentable Full Stack Code Challenge

## Table of Contents
* [Project Overview](#project-overview)
    * [Simulated PMS API](#simulated-pms-api)
        * [API Spec](#api-spec)
* [Getting Started](#getting-started)
* [The Challenge](#the-challenge)
* [How to Submit](#how-to-submit)
* [FAQ](#faq)
* [Questions](#questions)

Welcome to the Rentable Full Stack Code Challenge! This challenge evaluates your ability to translate a business need into a working solution using AI-assisted development. AI tooling (e.g., Cursor, GitHub Copilot) is expected to be used, but you own every line of code you submit. Be prepared to walk through your implementation and explain why you chose the code you submitted.

## Project Overview

This project simulates a property management system for managing tenant's and their transaction ledgers.

There is a **React front end** that displays a list of Tenants with a button for viewing transaction ledgers. 

There is a **Python and Django backend** with APIs that return tenants and their transactions. The Django backend utilizes a SQLite database.

Transactions can be imported from the PMS integration API into the local database using the `import_transactions` management command. This command is the source of truth for tenant and transaction data: it pulls live tenants and their ledgers directly from the API.

### Simulated PMS API

Tenant and transaction data comes from a simulated external Property Management System (PMS) integration API, hosted separately from this project.

#### API Spec

[`backend/api/integration-data/PMS_API_SPEC.md`](backend/api/integration-data/PMS_API_SPEC.md)

## Getting Started

This repo includes a [Dev Container](https://containers.dev/) config (`.devcontainer/`). It's the quickest way to get running: the container installs dependencies and migrates the database for you. Not using Dev Containers? `.devcontainer/post_create.sh` shows what you'd need to do yourself.

To populate the database with tenant and transaction data, run the import command:

```
cd backend && python manage.py import_transactions && cd ..
```

This is the only supported way to load tenant data — there is no local seed fixture, so the database always reflects the live PMS integration API.

Once set up, run `./start.sh` from the project root. The backend runs at [`http://127.0.0.1:8009/`](http://127.0.0.1:8009/) and the frontend at [`http://localhost:3009/`](http://localhost:3009/).

## The Challenge

The Head of Accounting at Couchman & Wavehill, one of our largest customers, is asking for ledger functionality. Their accounting team needs more visibility into tenant financials to reconcile their books efficiently. A View Ledger button has been added, but it currently does nothing. When they click it, they should see that tenant's transactions. And they need to see the balance on there too. We're trying to expand our relationship with them, so we want to do everything we can so that they want to move forward.


## How to Submit

This project is configured as a GitHub Template repository for you to clone, solve, and then push to your own GitHub account. To submit your solution, please follow these steps:

1.  **Create Your Own Repository:** On the Rentable Full Stack Code Challenge GitHub page, click the green "Use this template" button. This will allow you to create a new repository under your own GitHub account, pre-populated with this challenge's codebase.

2.  **Clone Your Repository:** Clone your newly created repository to your local machine using `git clone`.

3.  **Complete the Challenge:** Work on the challenge within your local clone.

4.  **Push Your Changes:** Commit your changes and push them to your repository on GitHub.

5.  **IMPORTANT - Share the Link:** Share the URL of your completed GitHub repository with your hiring contact.


## FAQ

*   **Will this be part of the Technical Interview?:** Your submitted code will be reviewed during a follow-up technical interview, where we will discuss your how you went about learning the codebase and implementation details. We will also perform a live code exercise building upon your solution.

*   **Can I use AI Tooling?** Yes. AI development tools (e.g., GitHub Copilot, ChatGPT, Cursor AI) are expected to be used. Be prepared to thoroughly discuss your implementation decisions during the follow-up interview, including any choices suggested by AI tooling.

## Questions

If you have any questions about the challenge, please feel free to email your hiring contact.