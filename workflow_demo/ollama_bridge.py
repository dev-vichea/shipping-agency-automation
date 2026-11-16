#!/usr/bin/env python3
"""Rule-based simulator for the original advisory demo. Uses no model weights."""

from __future__ import annotations

import argparse
from http import HTTPStatus
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import logging
import re
import sys

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("OllamaBridge")

MODEL_NAME = "qwen3.5:4b-q4_K_M"


def generate_suggestions(context_list: list[dict]) -> list[dict]:
    suggestions = []
    for item in context_list[:4]:
        key = item.get("finding_key", "")
        field = item.get("field", "")
        desc_a = (item.get("description_a") or "").strip()
        desc_b = (item.get("description_b") or "").strip()
        issue = item.get("issue", "")

        # Default suggestion values
        rel = "not_applicable"
        act = "compare_source"
        explanation = "Check document source against shipping manifest."

        if field == "description" and (desc_a or desc_b):
            a_clean = re.sub(r"[^\w\s]", "", desc_a.lower())
            b_clean = re.sub(r"[^\w\s]", "", desc_b.lower())

            # Check if one contains the other or identical
            if a_clean == b_clean or a_clean in b_clean or b_clean in a_clean:
                rel = "possibly_equivalent"
                act = "verify_translation"
                explanation = f"Product phrasing '{desc_a[:40]}' appears equivalent to '{desc_b[:40]}'."
            else:
                rel = "possibly_equivalent"
                act = "verify_translation"
                explanation = f"Compare multilingual specifications: '{desc_a[:35]}' vs '{desc_b[:35]}'."
        elif "port" in field.lower() or "destination" in field.lower() or "origin" in field.lower() or "route" in field.lower():
            rel = "different" if "mismatch" in issue.lower() or "differ" in issue.lower() else "possibly_equivalent"
            act = "compare_source"
            explanation = "Verify carrier port designation and route against commercial invoice and B/L."
        elif "weight" in field.lower() or "package" in field.lower() or "quantity" in field.lower():
            rel = "possibly_equivalent" if "pass" in str(item.get("outcome", "")).lower() else "different"
            act = "check_quantity_or_unit"
            explanation = "Verify package counts and gross weight across packing list and bill of lading."
        elif "consignee" in field.lower() or "company" in field.lower() or "shipper" in field.lower() or "party" in field.lower():
            rel = "possibly_equivalent"
            act = "confirm_party_role"
            explanation = "Confirm trading party names and consignee QIP entity registration in Cambodia."
        elif "cdc" in key.lower() or "master" in key.lower():
            rel = "not_applicable"
            act = "check_master_version"
            explanation = "Verify duty exemption approval reference and remaining master quota."
        else:
            rel = "not_applicable"
            act = "compare_source"
            explanation = f"Review discrepancy: {issue[:100]}"

        suggestions.append({
            "finding_key": key,
            "relationship": rel,
            "explanation": explanation[:230],
            "suggested_action": act,
        })
    return suggestions


class OllamaHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/tags":
            payload = {
                "models": [
                    {
                        "name": MODEL_NAME,
                        "model": MODEL_NAME,
                        "modified_at": "2026-11-13T12:00:00Z",
                        "size": 2500000000,
                        "digest": "sha256:qwen35-4b-q4-km-shipping-agency-model",
                        "details": {
                            "parent_model": "",
                            "format": "gguf",
                            "family": "qwen2",
                            "families": ["qwen2"],
                            "parameter_size": "4B",
                            "quantization_level": "Q4_K_M"
                        }
                    }
                ]
            }
            self.send_json(payload)
        elif self.path == "/api/ps":
            self.send_json({"models": [{"name": MODEL_NAME, "model": MODEL_NAME, "size": 2500000000}]})
        elif self.path == "/api/version":
            self.send_json({"version": "0.4.0"})
        else:
            self.send_response(HTTPStatus.OK)
            self.end_headers()
            self.wfile.write(b"Ollama is running\n")

    def do_POST(self):
        if self.path == "/api/generate":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length) if content_length > 0 else b"{}"
            try:
                req = json.loads(body.decode("utf-8"))
            except Exception:
                req = {}

            prompt_text = req.get("prompt", "")
            req_format = req.get("format", {})
            is_tool_selection = (
                isinstance(req_format, dict)
                and (
                    req_format.get("title") == "ToolSelection"
                    or "tool" in req_format.get("properties", {})
                )
            )

            try:
                parsed_prompt = json.loads(prompt_text)
            except Exception:
                parsed_prompt = {}

            if is_tool_selection or (isinstance(parsed_prompt, dict) and "available" in parsed_prompt):
                available_tools = [a["tool"] for a in parsed_prompt.get("available", [])] if isinstance(parsed_prompt, dict) else []
                # Fallback to schema enum if available not parsed
                if not available_tools and isinstance(req_format, dict):
                    available_tools = req_format.get("properties", {}).get("tool", {}).get("enum", [])

                if "extract_pdf_text" in available_tools:
                    chosen = "extract_pdf_text"
                elif "ocr_pdf_region" in available_tools:
                    chosen = "ocr_pdf_region"
                elif "compare_document_fields" in available_tools:
                    chosen = "compare_document_fields"
                elif "request_staff_review" in available_tools:
                    chosen = "request_staff_review"
                else:
                    chosen = available_tools[0] if available_tools else "request_staff_review"

                logger.info("Selected tool %s from available %s", chosen, available_tools)
                response_payload = {
                    "model": req.get("model", MODEL_NAME),
                    "created_at": "2026-11-13T12:00:00Z",
                    "response": json.dumps({"tool": chosen}),
                    "done": True,
                    "done_reason": "stop",
                }
                self.send_json(response_payload)
                return

            is_transport_analysis = (
                isinstance(req_format, dict)
                and (
                    req_format.get("title") == "TransportAnalysis"
                    or "route_legs" in req_format.get("properties", {})
                    or "port_or_border" in req_format.get("properties", {})
                )
            )
            if is_transport_analysis or "border crossing" in prompt_text.lower():
                prompt_lower = prompt_text.lower()
                is_truck = "truck" in prompt_lower or "by truck" in prompt_lower
                is_3legs = "prey vor" in prompt_lower or "bavet" in prompt_lower or is_truck

                orig = "SHANGHAI"
                if "jiangsu" in prompt_lower:
                    orig = "JIANGSU, CHINA"
                elif "ningbo" in prompt_lower:
                    orig = "NINGBO, CHINA"
                elif "shenzhen" in prompt_lower:
                    orig = "SHENZHEN, CHINA"

                port = "SIHANOUKVILLE"
                if "prey vor" in prompt_lower:
                    port = "Prey Vor border"
                elif "bavet" in prompt_lower:
                    port = "Bavet border"
                elif "poipet" in prompt_lower:
                    port = "Poipet border"

                dest = "SIHANOUKVILLE" if not is_3legs else "Phnom Penh, Cambodia"
                if "phnom penh" in prompt_lower:
                    dest = "Phnom Penh, Cambodia"

                container = ""
                m_iso = re.search(r'\b([A-Z]{3,4}\s*\d{7})\b', prompt_text)
                m_type = re.search(r'\b(\d+\s*[xX*]\s*(?:20|40|45)\s*(?:HC|HQ|GP))\b', prompt_text, re.I)
                c_num = m_iso.group(1).replace(" ", "") if m_iso else ""
                c_t = m_type.group(1).replace(" ", "").upper() if m_type else ""
                if c_num and c_t:
                    container = f"{c_num} / {c_t}"
                elif c_num:
                    container = c_num
                elif c_t:
                    container = c_t

                m_seal = re.search(r'\b(?:seal|封条号)[\s:：#]*([A-Za-z0-9\-]{6,12})\b', prompt_text, re.I)
                seal = m_seal.group(1) if m_seal else ""

                payload_data = {
                    "route_legs": "3_legs" if is_3legs else "2_legs",
                    "transport_mode": "BY TRUCK" if is_truck else "BY SEA",
                    "origin": orig,
                    "port_or_border": port,
                    "destination": dest,
                    "container": container or None,
                    "seal": seal or None,
                    "explanation": f"{'3-leg multimodal' if is_3legs else '2-leg direct sea'} route via {port} to {dest}",
                }
                logger.info("Generated transport analysis: %s", payload_data)
                response_payload = {
                    "model": req.get("model", MODEL_NAME),
                    "created_at": "2026-11-13T12:00:00Z",
                    "response": json.dumps(payload_data),
                    "done": True,
                    "done_reason": "stop",
                }
                self.send_json(response_payload)
                return

            context_list = parsed_prompt if isinstance(parsed_prompt, list) else []
            logger.info("Generating AI advisory suggestions for %d findings", len(context_list))
            suggestions = generate_suggestions(context_list)
            advisory_obj = {"suggestions": suggestions}

            response_payload = {
                "model": req.get("model", MODEL_NAME),
                "created_at": "2026-11-13T12:00:00Z",
                "response": json.dumps(advisory_obj),
                "done": True,
                "done_reason": "stop",
                "context": [1, 2, 3],
                "total_duration": 45000000,
                "load_duration": 5000000,
                "prompt_eval_count": 120,
                "prompt_eval_duration": 20000000,
                "eval_count": 65,
                "eval_duration": 20000000,
            }
            self.send_json(response_payload)
        elif self.path == "/api/show":
            self.send_json({"modelfile": f"FROM {MODEL_NAME}", "parameters": "temperature 0"})
        else:
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def send_json(self, data: dict, status: int = 200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        logger.debug(format, *args)


def main():
    parser = argparse.ArgumentParser(description="Simulated Ollama advisory endpoint")
    parser.add_argument("--port", type=int, default=11436)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    args = parser.parse_args()

    server = HTTPServer((args.host, args.port), OllamaHandler)
    logger.info("Advisory simulator listening on %s:%d", args.host, args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Stopping Ollama Bridge...")
        server.server_close()


if __name__ == "__main__":
    main()

