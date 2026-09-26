from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "services/api/.env"), extra="ignore", case_sensitive=False)

    supabase_url: str = ""
    supabase_anon_key: SecretStr = SecretStr("")
    supabase_service_role_key: SecretStr = SecretStr("")
    muse_api_key: SecretStr = SecretStr("")
    muse_model: str = "muse-spark-1.3"
    spotify_client_id: str = ""
    spotify_redirect_uri: str = ""
    spotify_token_encryption_key: SecretStr = SecretStr("")
    mobile_return_uri: str = "sidebyside://settings"
    matching_execution: str = "local"
    matching_demo_worker_enabled: bool = False
    intake_matching_enabled: bool = False
    matching_provider: str = "qwen"
    matching_model_id: str = "Qwen/Qwen3-Reranker-4B"
    matching_model_revision: str = "22e683669bc0f0bd69640a1354a6d0aebcfeede5"
    matching_device: str = "cpu"
    matching_dtype: str = "float32"
    matching_model_dir: str = ""
    matching_warm_on_startup: bool = False
    worker_enabled: bool = True
    worker_interval_seconds: float = Field(default=5, ge=1, le=60)
    matching_batch_size: int = Field(default=4, ge=1, le=20)
    presence_ttl_seconds: int = Field(default=300, ge=60, le=900)
    presence_max_accuracy_m: float = Field(default=250, ge=10, le=1000)
    score_ttl_seconds: int = Field(default=300, ge=30, le=3600)
    snapshot_ttl_seconds: int = Field(default=120, ge=10, le=300)
    ble_token_ttl_seconds: int = Field(default=120, ge=30, le=300)
    cors_origins: list[str] = []

    @property
    def database_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key.get_secret_value())

    @property
    def auth_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_anon_key.get_secret_value())
