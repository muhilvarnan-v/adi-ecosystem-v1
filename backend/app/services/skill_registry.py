import asyncio
import base64
import io
import zipfile
from typing import Any

import google.auth
import google.auth.transport.requests
import httpx

from app.config import Settings


class SkillRegistryService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._project = settings.agent_platform_project_id or settings.firestore_project_id
        self._location = settings.agent_platform_location

    @property
    def _base_url(self) -> str:
        return (
            f"https://{self._location}-aiplatform.googleapis.com/v1beta1"
            f"/projects/{self._project}/locations/{self._location}"
        )

    def _get_access_token(self) -> str:
        credentials, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
        credentials.refresh(google.auth.transport.requests.Request())
        return credentials.token

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._get_access_token()}",
            "Content-Type": "application/json",
        }

    @staticmethod
    def build_zip(files: dict[str, bytes]) -> str:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for path, content in sorted(files.items()):
                zf.writestr(path, content)
        return base64.b64encode(buffer.getvalue()).decode("ascii")

    async def create_skill(
        self,
        skill_id: str,
        display_name: str,
        description: str,
        files: dict[str, bytes],
    ) -> dict[str, Any]:
        payload = {
            "displayName": display_name,
            "description": description,
            "zippedFilesystem": self.build_zip(files),
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{self._base_url}/skills",
                params={"skillId": skill_id},
                headers=self._headers(),
                json=payload,
            )
            response.raise_for_status()
            operation = response.json()
            return await self._wait_for_operation(client, operation)

    async def update_skill(
        self,
        skill_id: str,
        display_name: str | None = None,
        description: str | None = None,
        files: dict[str, bytes] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        update_mask: list[str] = []
        if display_name is not None:
            payload["displayName"] = display_name
            update_mask.append("displayName")
        if description is not None:
            payload["description"] = description
            update_mask.append("description")
        if files is not None:
            payload["zippedFilesystem"] = self.build_zip(files)
            update_mask.append("zippedFilesystem")

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.patch(
                f"{self._base_url}/skills/{skill_id}",
                params={"updateMask": ",".join(update_mask)},
                headers=self._headers(),
                json=payload,
            )
            response.raise_for_status()
            operation = response.json()
            return await self._wait_for_operation(client, operation)

    async def list_skills(self) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(
                f"{self._base_url}/skills",
                headers=self._headers(),
            )
            response.raise_for_status()
            data = response.json()
            return data.get("skills", [])

    async def get_skill(self, skill_id: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(
                f"{self._base_url}/skills/{skill_id}",
                headers=self._headers(),
            )
            response.raise_for_status()
            return response.json()

    async def delete_skill(self, skill_id: str) -> None:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.delete(
                f"{self._base_url}/skills/{skill_id}",
                headers=self._headers(),
            )
            response.raise_for_status()
            if response.content:
                operation = response.json()
                if operation.get("name"):
                    await self._wait_for_operation(client, operation)

    async def _wait_for_operation(
        self,
        client: httpx.AsyncClient,
        operation: dict[str, Any],
        max_attempts: int = 30,
    ) -> dict[str, Any]:
        name = operation.get("name", "")
        if not name:
            return operation

        if operation.get("done"):
            if operation.get("error"):
                raise RuntimeError(operation["error"].get("message", "Skill operation failed"))
            return operation.get("response", operation)

        operation_url = f"https://{self._location}-aiplatform.googleapis.com/v1beta1/{name}"
        for _ in range(max_attempts):
            await asyncio.sleep(2)
            response = await client.get(operation_url, headers=self._headers())
            response.raise_for_status()
            operation = response.json()
            if operation.get("done"):
                if operation.get("error"):
                    raise RuntimeError(operation["error"].get("message", "Skill operation failed"))
                return operation.get("response", operation)
        raise TimeoutError("Skill registry operation timed out")

    @staticmethod
    def skill_id_from_name(name: str) -> str:
        return name.rsplit("/", 1)[-1]
