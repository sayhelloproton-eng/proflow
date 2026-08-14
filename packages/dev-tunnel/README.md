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

Manages the Microsoft Dev Tunnel (`devtunnel`) public HTTPS ingress. Login is a
user external-account fact and is never faked.
