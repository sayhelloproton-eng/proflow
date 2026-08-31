# dev-tunnel

Domain Owner: deployment-governance
Module Kind: external-resource
Service: none
Process: none (except the managed `devtunnel host` external CLI child)
Business Fact Owner: none

## Owner

Deployment Governance

## Consumers

- agent-gateway

## Does NOT own

- Agent Gateway
- Gateway routing
- Gateway auth
- Task/Agent facts

## Purpose

Manages the Microsoft Dev Tunnel (`devtunnel`) public HTTPS ingress. The Module
owns acquisition of the pinned official CLI into its own package-local `.devtunnel/`
directory and never resolves a system PATH `devtunnel`. Existing login is reused;
when login is unavailable, the only human action is GitHub browser authorization
initiated by the package-owned CLI. Account state is never faked.
