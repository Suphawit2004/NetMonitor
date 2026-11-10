import asyncio
import os
import subprocess
import logging
from typing import Optional

logger = logging.getLogger("netmonitor.snmp")

# Standard OIDs
OID_SYS_DESCR  = ".1.3.6.1.2.1.1.1.0"
OID_SYS_UPTIME = ".1.3.6.1.2.1.1.3.0"
OID_SYS_NAME   = ".1.3.6.1.2.1.1.5.0"

def _run_snmpget_sync(cmd: list[str], timeout_s: float) -> tuple[int, bytes, bytes]:
    env = os.environ.copy()
    env["MIBS"] = ""
    if os.name == "nt" and r"C:\usr\bin" not in env.get("PATH", ""):
        env["PATH"] = r"C:\usr\bin;" + env.get("PATH", "")
    try:
        res = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout_s,
            env=env,
        )
        return res.returncode, res.stdout, res.stderr
    except subprocess.TimeoutExpired:
        return 1, b"", b"SNMP CLI execution timed out"
    except Exception as e:
        return 1, b"", str(e).encode("utf-8")

async def snmp_get_oid(
    ip: str,
    oid: str,
    community: str = "public",
    version: str = "2c",
    port: int = 161,
    timeout_s: int = 2,
    retries: int = 1,
) -> tuple[bool, Optional[str], Optional[str]]:
    """
    Executes snmpget CLI asynchronously using a worker thread
    to ensure full compatibility with Windows event loop policies.
    Returns: (success: bool, value: Optional[str], error: Optional[str])
    """
    cmd = [
        "snmpget",
        f"-v{version}",
        f"-c{community}",
        f"-t{timeout_s}",
        f"-r{retries}",
        "-Oqv",  # Quick format: only print the value
        f"{ip}:{port}",
        oid,
    ]
    try:
        returncode, stdout, stderr = await asyncio.to_thread(
            _run_snmpget_sync, cmd, timeout_s * (retries + 1) + 1.0
        )
        if returncode == 0:
            val = stdout.decode("utf-8", errors="replace").strip()
            return True, val, None
        else:
            err = stderr.decode("utf-8", errors="replace").strip()
            return False, None, err or f"snmpget exited with code {returncode}"
    except Exception as e:
        logger.debug(f"Failed to run snmpget for {ip}: {e}")
        return False, None, str(e)

