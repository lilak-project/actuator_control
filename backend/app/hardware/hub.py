"""Registry of the actuators this server currently holds a connection to."""

from __future__ import annotations

import threading

from .manager import ActuatorManager


class ActuatorHub:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._managers: dict[str, ActuatorManager] = {}

    def connect(self, ip: str, name: str = "", max_position: float | None = None) -> dict:
        ip = str(ip).strip()
        if not ip:
            raise ValueError("IP address is required")
        with self._lock:
            if ip in self._managers:
                raise ValueError(f"{ip} is already connected")
        # Built outside the lock: opening a CIP session can take a moment and
        # must not block status reads for the other axes.
        manager = ActuatorManager(ip, name, max_position=max_position)
        with self._lock:
            if ip in self._managers:
                manager.close()
                raise ValueError(f"{ip} is already connected")
            self._managers[ip] = manager
        return manager.snapshot()

    def disconnect(self, ip: str, sv_off: bool = False) -> None:
        with self._lock:
            manager = self._managers.pop(str(ip).strip(), None)
        if manager is None:
            raise RuntimeError("Not connected")
        manager.close(sv_off=sv_off)

    def disconnect_all(self) -> None:
        with self._lock:
            managers = list(self._managers.values())
            self._managers.clear()
        for manager in managers:
            try:
                manager.close()
            except Exception:
                pass

    def get(self, ip: str) -> ActuatorManager:
        with self._lock:
            manager = self._managers.get(str(ip).strip())
        if manager is None:
            raise RuntimeError(f"{ip} is not connected")
        return manager

    def release_idle(self, timeout: float) -> list[str]:
        """Switch off every axis idle for longer than `timeout`. Returns their IPs."""
        with self._lock:
            managers = list(self._managers.values())
        released = []
        for manager in managers:
            try:
                if manager.release_if_idle(timeout):
                    released.append(manager.ip)
            except Exception:
                # A watchdog that dies on one bad axis protects none of them.
                pass
        return released

    def snapshots(self) -> list[dict]:
        with self._lock:
            managers = list(self._managers.values())
        return [manager.snapshot() for manager in managers]

    def connected_ips(self) -> set[str]:
        with self._lock:
            return set(self._managers)


hub = ActuatorHub()
