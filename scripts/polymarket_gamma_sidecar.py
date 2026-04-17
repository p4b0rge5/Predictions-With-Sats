#!/usr/bin/env python3

import asyncio
import json
import sys
from typing import Any

from py_gamma import GammaClient
from py_gamma.exceptions import GammaAPIError

TEAM_PAGE_LIMIT = 500
TEAM_MAX_PAGES = 10


async def fetch_sports() -> list[dict[str, Any]]:
    async with GammaClient() as client:
        sports = await client.sports.get_sports()
        return [sport.model_dump(mode="json") for sport in sports]


async def fetch_teams() -> list[dict[str, Any]]:
    async with GammaClient() as client:
        teams: list[dict[str, Any]] = []

        for page in range(TEAM_MAX_PAGES):
            response = await client.http_client.request(
                "GET",
                "/teams",
                params={"limit": TEAM_PAGE_LIMIT, "offset": page * TEAM_PAGE_LIMIT},
            )
            batch = response.json()
            if not isinstance(batch, list):
                break

            teams.extend([item for item in batch if isinstance(item, dict)])
            if len(batch) < TEAM_PAGE_LIMIT:
                break

        return teams


async def fetch_event_by_slug(slug: str) -> dict[str, Any] | None:
    async with GammaClient() as client:
        try:
            response = await client.http_client.request("GET", f"/events/slug/{slug}")
        except GammaAPIError as exc:
            if exc.status_code == 404:
                return None
            raise

        payload = response.json()
        return payload if isinstance(payload, dict) else None


async def run(argv: list[str]) -> Any:
    if len(argv) < 2:
        raise SystemExit("usage: polymarket_gamma_sidecar.py <sports|teams|event-by-slug> [args]")

    command = argv[1]

    if command == "sports":
        return await fetch_sports()
    if command == "teams":
        return await fetch_teams()
    if command == "event-by-slug":
        if len(argv) < 3:
            raise SystemExit("usage: polymarket_gamma_sidecar.py event-by-slug <slug>")
        return await fetch_event_by_slug(argv[2])

    raise SystemExit(f"unknown command: {command}")


def main() -> int:
    try:
        payload = asyncio.run(run(sys.argv))
        print(json.dumps(payload))
        return 0
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
