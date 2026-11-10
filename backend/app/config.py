import os
from pathlib import Path
from pydantic import BaseModel
from dotenv import load_dotenv

env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)
load_dotenv()

class Settings(BaseModel):
    DB_HOST: str = os.getenv("DB_HOST", "127.0.0.1")
    DB_PORT: int = int(os.getenv("DB_PORT", "5432"))
    DB_USER: str = os.getenv("DB_USER", "netmon")
    DB_PASSWORD: str = os.getenv("DB_PASSWORD", "netmon")
    DB_NAME: str = os.getenv("DB_NAME", "netmon")
    SNMP_COMMUNITY: str = os.getenv("SNMP_COMMUNITY", "public")
    API_PORT: int = int(os.getenv("API_PORT", "8000"))
    API_KEY: str = os.getenv("API_KEY", "")
    MAP_API_KEY: str = os.getenv("MAP_API_KEY", "")

settings = Settings()

