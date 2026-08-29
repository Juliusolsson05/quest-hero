# A 3D Game with Thinking NPCs

*Hackathon project brief*

## Overview

We are building a 3D game whose NPCs can actually think and draw on current, real-world information.

The goal is two-fold: the game itself should be fully functional and genuinely fun to play, and every character in it should run on an agent harness with MCP tools available to it. That means an NPC can answer a player's questions about the world inside the game, and about the world outside it as well.

## How It Works

Each character is backed by an agent rather than a fixed dialogue tree. Because that agent has MCP tools at its disposal, an NPC is not limited to lines we wrote in advance. It can look things up, reason about what the player is asking, and respond in context — whether the question is about a quest, a game mechanic, or something happening in the real world today.

## The Three Parts of the Problem

We see this as three distinct pieces of work.

### 1. Web search in the MCP server

Giving the NPCs access to live, modern information. This is the part that lets a character speak to events and facts beyond anything baked into the game at build time.

### 2. Building a game that is actually good

The 3D game has to stand on its own. Smart NPCs are not a substitute for solid mechanics, and the experience needs to be fun to play even before the agent layer is considered.

### 3. Using MCP to make NPCs smart about game mechanics

Beyond outside knowledge, we want the characters to understand the game they live in. MCP is how we expose the game's own state and rules to the agents, so an NPC can reason about mechanics and help the player navigate them.
