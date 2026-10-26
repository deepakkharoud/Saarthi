"""
SAARTHI WebSocket Routes
========================
Handles real-time streaming communication with the client.
Orchestrates video frame routing, audio/text inquiries, and instant mode switching.
"""

import json
import asyncio
import logging
from typing import Dict, Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..models import SessionState, TaskState
from ..utils import Console
from ..services.memory import memory_store
from ..services.processor import (
    process_frame,
    process_micro_frame,
    process_task_frame,
    process_inquiry,
    _handle_task_control,
    _generate_task_plan,
    safe_send_json,
    global_task_state
)

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """
    Main real-time WebSocket endpoint.
    Orchestrates the continuous video frame processing loop and control actions.
    """
    await websocket.accept()
    
    # Initialize Session State
    state = SessionState()
    
    # Startup Logs
    Console.header()
    Console.log('connect', 'Client connected to SAARTHI Vision Pipeline', 'green')

    # RESTORE STATE: If client is reconnecting, restore active task
    if global_task_state.is_valid():
        state.task_state = global_task_state.to_task_state()
        state.mode = "task"
        Console.log('info', f"Restored Active Task: {global_task_state.task_name}", 'cyan')
        
        await safe_send_json(websocket, {
            "type": "task_update",
            "plan": state.task_state.plan,
            "current_step_index": state.task_state.current_step_index,
            "restored": True
        })
        
        if state.task_state.current_step:
            await safe_send_json(websocket, {
                "type": "speak",
                "text": f"Resuming task. Step: {state.task_state.current_step['instruction']}"
            })

    frame_event = asyncio.Event()

    async def _frame_processor_loop():
        """
        Consumer task: Waits for frames and routes to mode processors.
        Runs in parallel to message reception.
        """
        while True:
            try:
                await frame_event.wait()
                frame_event.clear()
                
                if state.latest_frame and not state.is_processing:
                    state.is_processing = True
                    frame_data = state.latest_frame
                    state.latest_frame = None
                    
                    try:
                        if state.mode == 'micro':
                            await process_micro_frame(frame_data, state, websocket)
                        elif state.mode == 'task':
                            await process_task_frame(frame_data, state, websocket)
                        else:
                            await process_frame(frame_data, state, websocket)
                            
                    except Exception as e:
                        logging.error(f"Frame Processing Exception: {e}")
                    finally:
                        state.is_processing = False
                        if state.latest_frame:
                            frame_event.set()
                            
            except asyncio.CancelledError:
                break
            except Exception as e:
                logging.error(f"Frame Loop Fatal Error: {e}")
                state.is_processing = False

    processor_task = asyncio.create_task(_frame_processor_loop())

    try:
        while True:
            message = await websocket.receive()
            
            if message["type"] == "websocket.disconnect":
                break
            
            if "text" in message:
                try:
                    data = json.loads(message["text"])
                    msg_type = data.get("type")

                    if msg_type == "inquiry":
                        await process_inquiry(data, state, websocket)
                        if state.task_state.is_active:
                            global_task_state.update_from(state.task_state)

                    elif msg_type == "set_mode":
                        new_mode = data.get("mode", "nav")
                        target = data.get("target")
                        state.mode = new_mode
                        if target:
                            state.micro_target = target
                        await safe_send_json(websocket, {
                            "type": "mode_changed",
                            "mode": state.mode,
                            "target": state.micro_target
                        })

                    elif msg_type == "task_action":
                        action = data.get("action", "done")
                        intent = f"task_{action}"
                        speech_reply = await _handle_task_control(intent, state, websocket)
                        await safe_send_json(websocket, {"type": "speak", "text": speech_reply})

                    elif msg_type == "start_task":
                        task_name = data.get("task_name", "Guided Physical Task")
                        speech_reply = await _generate_task_plan(task_name, state, websocket)
                        await safe_send_json(websocket, {"type": "speak", "text": speech_reply})

                    elif msg_type == "search":
                        goal = data.get("goal")
                        state.mode = "nav"
                        state.current_goal = goal
                        await safe_send_json(websocket, {
                            "type": "inquiry_result",
                            "current_goal": goal,
                            "mode": "nav",
                            "thinking": f"Searching environment for '{goal}'"
                        })
                        await safe_send_json(websocket, {
                            "type": "speak",
                            "text": f"Searching for {goal}."
                        })

                    elif msg_type == "tag_location":
                        name = data.get("name", "Tagged Spot")
                        desc = data.get("description", "Anchor location")
                        memory_store.add_location(name, desc)
                        await safe_send_json(websocket, {
                            "type": "speak",
                            "text": f"Tagged {name} in Memory Palace."
                        })

                    elif msg_type == "ping":
                        await safe_send_json(websocket, {
                            "type": "pong",
                            "timestamp": data.get("timestamp")
                        })

                except json.JSONDecodeError:
                    pass

            elif "bytes" in message:
                # Video frame received
                state.frames_received += 1
                frame_payload = {
                    "image": message["bytes"], 
                    "heading": state.last_direction or 0, 
                    "task": state.mode
                }
                
                # Head-of-line drop: keep freshest frame
                if not state.is_processing:
                    state.latest_frame = frame_payload
                    frame_event.set()
                else:
                    state.latest_frame = frame_payload
                    state.frames_skipped += 1

    except WebSocketDisconnect:
        Console.log('disconnect', 'Client disconnected from WebSocket', 'yellow')
    except Exception as e:
        logging.error(f"WebSocket Connection Error: {e}")
    finally:
        if state.task_state.is_active:
            global_task_state.update_from(state.task_state)
            Console.log('info', "Task state preserved in global storage", 'cyan')
            
        processor_task.cancel()
        try:
            await processor_task
        except asyncio.CancelledError:
            pass
