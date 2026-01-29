"""
TargetUP AI - LLM Client
Claude API 연동 클라이언트
"""
import os
import json
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from pathlib import Path

try:
    import anthropic
    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False

# .env 파일 로드
def load_env():
    """환경변수 로드 (.env 파일)"""
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ[key.strip()] = value.strip()

load_env()


@dataclass
class LLMConfig:
    """LLM 설정"""
    api_key: str = ""
    model: str = "claude-sonnet-4-20250514"
    max_tokens: int = 4096
    temperature: float = 0.7
    
    @classmethod
    def from_env(cls) -> 'LLMConfig':
        return cls(
            api_key=os.getenv('ANTHROPIC_API_KEY', ''),
            model=os.getenv('CLAUDE_MODEL', 'claude-sonnet-4-20250514'),
        )
    
    @property
    def is_valid(self) -> bool:
        return bool(self.api_key and self.api_key.startswith('sk-ant-'))


class ClaudeClient:
    """Claude API 클라이언트"""
    
    def __init__(self, config: Optional[LLMConfig] = None):
        self.config = config or LLMConfig.from_env()
        self._client = None
        
    @property
    def is_available(self) -> bool:
        """API 사용 가능 여부"""
        return HAS_ANTHROPIC and self.config.is_valid
    
    @property
    def client(self):
        """Anthropic 클라이언트 (lazy init)"""
        if self._client is None and self.is_available:
            self._client = anthropic.Anthropic(api_key=self.config.api_key)
        return self._client
    
    def chat(self, 
             messages: List[Dict[str, str]], 
             system: str = "",
             temperature: Optional[float] = None,
             max_tokens: Optional[int] = None) -> str:
        """
        Claude API 호출
        
        Args:
            messages: [{"role": "user", "content": "..."}, ...]
            system: 시스템 프롬프트
            temperature: 온도 (기본값 사용시 None)
            max_tokens: 최대 토큰 (기본값 사용시 None)
            
        Returns:
            응답 텍스트
        """
        if not self.is_available:
            raise RuntimeError("Claude API를 사용할 수 없습니다. API 키를 확인하세요.")
        
        response = self.client.messages.create(
            model=self.config.model,
            max_tokens=max_tokens or self.config.max_tokens,
            temperature=temperature if temperature is not None else self.config.temperature,
            system=system,
            messages=messages
        )
        
        return response.content[0].text
    
    def chat_json(self,
                  messages: List[Dict[str, str]],
                  system: str = "",
                  temperature: float = 0.3) -> Dict[str, Any]:
        """
        JSON 응답을 요청하고 파싱
        
        Args:
            messages: 메시지 목록
            system: 시스템 프롬프트 (JSON 출력 지시 포함 권장)
            temperature: 낮은 온도 권장 (정확성)
            
        Returns:
            파싱된 JSON dict
        """
        # 시스템 프롬프트에 JSON 지시 추가
        json_system = system + "\n\n반드시 유효한 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요."
        
        response_text = self.chat(
            messages=messages,
            system=json_system,
            temperature=temperature
        )
        
        # JSON 파싱 시도
        try:
            # JSON 블록 추출 (```json ... ``` 형식 처리)
            if "```json" in response_text:
                start = response_text.find("```json") + 7
                end = response_text.find("```", start)
                response_text = response_text[start:end].strip()
            elif "```" in response_text:
                start = response_text.find("```") + 3
                end = response_text.find("```", start)
                response_text = response_text[start:end].strip()
            
            return json.loads(response_text)
        except json.JSONDecodeError as e:
            # 파싱 실패시 빈 dict 반환
            print(f"JSON 파싱 실패: {e}")
            print(f"응답: {response_text[:500]}")
            return {}
    
    def get_usage_info(self) -> Dict[str, Any]:
        """API 사용 정보 (디버그용)"""
        return {
            "available": self.is_available,
            "has_library": HAS_ANTHROPIC,
            "has_key": bool(self.config.api_key),
            "model": self.config.model
        }


# 싱글톤 인스턴스
claude_client = ClaudeClient()


def check_api_status() -> Dict[str, Any]:
    """API 상태 확인"""
    status = {
        "anthropic_installed": HAS_ANTHROPIC,
        "api_key_set": bool(os.getenv('ANTHROPIC_API_KEY')),
        "api_key_valid": claude_client.config.is_valid,
        "ready": claude_client.is_available
    }
    
    if not HAS_ANTHROPIC:
        status["message"] = "anthropic 패키지를 설치하세요: pip install anthropic"
    elif not status["api_key_set"]:
        status["message"] = ".env 파일에 ANTHROPIC_API_KEY를 설정하세요"
    elif not status["api_key_valid"]:
        status["message"] = "API 키 형식이 올바르지 않습니다 (sk-ant-로 시작해야 함)"
    else:
        status["message"] = "Claude API 준비 완료!"
    
    return status
