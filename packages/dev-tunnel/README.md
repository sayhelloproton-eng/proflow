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

Manages the Microsoft Dev Tunnel (`devtunnel`) public HTTPS ingress. Existing
login is reused; when login is unavailable, the only human action is GitHub
browser authorization initiated by the provider CLI. Account state is never faked.
