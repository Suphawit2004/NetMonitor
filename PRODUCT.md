# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Purpose

NetMonitor is a real-time network topology and SNMP monitoring web application designed for network engineers and IT administrators to visualize, inspect, and manage active network hardware (switches, routers, APs, servers) across campus floors.

## Primary Users & Jobs

- **Network Administrators & Operations Engineers (NOC)**
  - Job: Rapidly scan topology status across building floors, detect offline/warning devices, inspect live interface throughput, and diagnose connection health.
  - Usage scene: Active desktop monitoring consoles, troubleshooting sessions during network congestion or link flaps.

## Core Capabilities

1. **Interactive Floorplan & Topology Map:** Visual pin placement of network devices on building floorplans with real-time status indicators (online, offline, warning, unmanaged).
2. **Real Physical SNMP Bandwidth Monitoring:** Live Counter64 (`ifHCInOctets`/`ifHCOutOctets`) metrics polled per interface and aggregated across switches (e.g. Aruba 2930F), complete with historical trajectory and linear interpolation.
3. **Device Management & Diagnostics:** Device detail inspection, SNMP interface port table, Ping test modal, SSH command launcher, Port reboot controls, and alert logs.
4. **Network Auto-Discovery:** Subnet scanning engine for discovering active network hardware via ICMP and SNMP.
5. **Localization:** Full bilingual support (Thai and English).

## Design Constraints & Commitments

- **Surface Mode: `Operate`** — Prioritize high scanability, rapid data perception, accessible contrast ratios (WCAG AA), crisp typography, and uncluttered layout.
- **Dual Theme Support:** Both Dark Theme (cockpit operations) and Light Theme (daytime admin work) with clean semantic CSS variables.
- **Minimum Type Floor:** 12px minimum for badges/captions, 13–14px for table/body, clean tabular figures (`font-variant-numeric: tabular-nums`) for network bandwidth rates.
