import Controls from '~/components/controls'
import Logs from '~/components/logs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BASE_URL, MODEL } from '~/lib/config'

type ToolCallOutput = {
	response: string
	[key: string]: any
}

function getSupportedMimeType() {
	const types = [
		'audio/webm;codecs=opus',
		'audio/ogg;codecs=opus',
		'audio/webm',
		'audio/ogg',
	]
	for (const type of types) {
		if (MediaRecorder.isTypeSupported(type)) {
			console.debug({ supType: type })
			return type
		}
	}
	return '' // Let browser pick default
}

export default function RealtimeApp({ instructions }: { instructions: string }) {
	const [logs, setLogs] = useState<any[]>([])
	const [toolCall, setToolCall] = useState<any>(null)
	const [isSessionStarted, setIsSessionStarted] = useState(false)
	const [isSessionActive, setIsSessionActive] = useState(false)
	const [isListening, setIsListening] = useState(false)

	const [dataChannel, setDataChannel] = useState<RTCDataChannel | null>(null)
	const peerConnection = useRef<RTCPeerConnection | null>(null)
	const audioElement = useRef<HTMLAudioElement | null>(null)
	const [audioStream, setAudioStream] = useState<MediaStream | null>(null)
	const audioTransceiver = useRef<RTCRtpTransceiver | null>(null)
	const tracks = useRef<RTCRtpSender[] | null>(null)

	// peerConnection.current?.ontrack = e => {
	//    const stream = e.streams[0]
	// }

	// recording state
	const [micRecorder, setMicRecorder] = useState<MediaRecorder | null>(null)
	const [micChunks, setMicChunks] = useState<Blob[]>([])
	const [audioUrl, setAudioUrl] = useState<string | null>(null)

	// Start a new realtime session
	async function startSession() {
		try {
			if (!isSessionStarted) {
				setIsSessionStarted(true)
				// Get an ephemeral session token
				const session = await fetch('/api/session', { method: 'POST' }).then((response) => response.json())
				const sessionToken = session.client_secret.value
				const sessionId = session.id

				console.log('Session id:', sessionId)

				// Create a peer connection
				const pc = new RTCPeerConnection()

				// Set up to play remote audio from the model
				if (!audioElement.current) {
					audioElement.current = document.createElement('audio')
				}
				audioElement.current.autoplay = true

				// listen for remote streams
				pc.ontrack = (e) => {
					if (audioElement.current) {
						audioElement.current.srcObject = e.streams[0]
					}
				}

				const stream = await navigator.mediaDevices.getUserMedia({
					audio: true,
				})

				stream.getTracks().forEach((track) => {
					const sender = pc.addTrack(track, stream)
					if (sender) {
						tracks.current = [...(tracks.current || []), sender]
					}
				})

				// Set up data channel for sending and receiving events
				const dc = pc.createDataChannel('oai-events')
				setDataChannel(dc)

				// Start the session using the Session Description Protocol (SDP)
				const offer = await pc.createOffer()
				await pc.setLocalDescription(offer)

				const sdpResponse = await fetch(`${BASE_URL}?model=${MODEL}`, {
					method: 'POST',
					body: offer.sdp,
					headers: {
						Authorization: `Bearer ${sessionToken}`,
						'Content-Type': 'application/sdp',
					},
				})

				const answer: RTCSessionDescriptionInit = {
					type: 'answer',
					sdp: await sdpResponse.text(),
				}
				await pc.setRemoteDescription(answer)

				peerConnection.current = pc
			}
		} catch (error) {
			console.error('Error starting session:', error)
		}
	}

	// Stop current session, clean up peer connection and data channel
	function stopSession() {
		if (dataChannel) {
			dataChannel.close()
		}
		if (peerConnection.current) {
			peerConnection.current.close()
		}

		setIsSessionStarted(false)
		setIsSessionActive(false)
		setDataChannel(null)
		peerConnection.current = null
		if (audioStream) {
			audioStream.getTracks().forEach((track) => track.stop())
		}
		setAudioStream(null)
		setIsListening(false)
		audioTransceiver.current = null
	}

	// Grabs a new mic track and replaces the placeholder track in the transceiver
	async function startRecording() {
		try {
			const newStream = await navigator.mediaDevices.getUserMedia({
				audio: true,
			})
			setAudioStream(newStream)

			// If we already have an audioSender, just replace its track:
			if (tracks.current) {
				const micTrack = newStream.getAudioTracks()[0]
				tracks.current.forEach((sender) => {
					sender.replaceTrack(micTrack)
				})
			} else if (peerConnection.current) {
				// Fallback if audioSender somehow didn't get set
				newStream.getTracks().forEach((track) => {
					const sender = peerConnection.current?.addTrack(track, newStream)
					if (sender) {
						tracks.current = [...(tracks.current || []), sender]
					}
				})
			}

			// START RECORDING MODULE
			const mimeType = getSupportedMimeType()
			const recorder = new MediaRecorder(newStream, mimeType ? { mimeType } : {})
			const chunks: Blob[] = []
			recorder.ondataavailable = (e) => {
				if (e.data.size > 0) chunks.push(e.data)
			}
			recorder.onstop = () => {
				setMicChunks(chunks)
				const blob = new Blob(chunks, { type: mimeType || 'audio/webm' })
				// const url = URL.createObjectURL(blob)
				// setAudioUrl(url)
			}
			recorder.start()
			setMicRecorder(recorder)
			// END RECORDING MODULE

			setIsListening(true)
			console.log('Microphone started.')
		} catch (error) {
			console.error('Error accessing microphone:', error)
		}
	}

	// Replaces the mic track with a placeholder track
	function stopRecording() {
		setIsListening(false)

		// START RECORDING MODULE
		if (micRecorder && micRecorder.state !== 'inactive') {
			micRecorder.stop()
		}
		// END RECORDING MODULE

		// Stop existing mic tracks so the user’s mic is off
		if (audioStream) {
			audioStream.getTracks().forEach((track) => track.stop())
		}
		setAudioStream(null)

		// Replace with a placeholder (silent) track
		if (tracks.current) {
			const placeholderTrack = createEmptyAudioTrack()
			tracks.current.forEach((sender) => {
				sender.replaceTrack(placeholderTrack)
			})
		}
	}

	// Creates a placeholder track that is silent
	function createEmptyAudioTrack(): MediaStreamTrack {
		const audioContext = new AudioContext()
		const destination = audioContext.createMediaStreamDestination()
		return destination.stream.getAudioTracks()[0]
	}

	// Send a message to the model
	const sendClientEvent = useCallback(
		(message: any) => {
			if (dataChannel) {
				message.event_id = message.event_id || crypto.randomUUID()
				dataChannel.send(JSON.stringify(message))
			} else {
				console.error(
					'Failed to send message - no data channel available',
					message,
				)
			}
		},
		[dataChannel],
	)

	// Attach event listeners to the data channel when a new one is created
	useEffect(() => {
		async function handleToolCall(output: any) {
			const toolCall = {
				name: output.name,
				arguments: output.arguments,
			}
			console.log('Tool call:', toolCall)
			setToolCall(toolCall)

			// TOOL CALL HANDLING
			// Initialize toolCallOutput with a default response
			const toolCallOutput: ToolCallOutput = {
				response: `Tool call ${toolCall.name} executed successfully.`,
			}

			// Handle special tool calls
			if (toolCall.name === 'get_iss_position') {
				const issPosition = await fetch('/api/iss').then((response) => response.json())
				console.log('ISS position:', issPosition)
				toolCallOutput.issPosition = issPosition
			}

			sendClientEvent({
				type: 'conversation.item.create',
				item: {
					type: 'function_call_output',
					call_id: output.call_id,
					output: JSON.stringify(toolCallOutput),
				},
			})

			// Force a model response to make sure it responds after certain tool calls
			if (
				toolCall.name === 'get_iss_position' ||
				toolCall.name === 'display_data'
			) {
				sendClientEvent({
					type: 'response.create',
				})
			}
		}

		if (dataChannel) {
			// Append new server events to the list
			dataChannel.addEventListener('message', (e) => {
				const event = JSON.parse(e.data)
				if (event.type.includes('input_audio_buffer')) {
					console.debug(event.type, event)
				}
				if (event.type === 'response.done') {
					const output = event.response.output[0]
					setLogs((prev) => [output, ...prev])
					if (output?.type === 'function_call') {
						handleToolCall(output)
					}
				}
			})

			// Set session active when the data channel is opened
			dataChannel.addEventListener('open', () => {
				setIsSessionActive(true)
				setIsListening(true)
				setLogs([])
				// Send session config
				const sessionUpdate = {
					type: 'session.update',
					session: {
						// tools: TOOLS,
						instructions,
					},
					// Enable Semantic VAD
					// turn_detection: {
					// 	type: 'semantic_vad',
					// 	eagerness: 'auto',
					// 	create_response: true, // only in conversation mode
					// 	interrupt_response: true, // only in conversation mode
					// },
				}
				sendClientEvent(sessionUpdate)
				console.log('Session update sent:', sessionUpdate)
			})
		}
	}, [dataChannel, sendClientEvent])

	const handleConnectClick = async () => {
		if (isSessionActive) {
			console.log('Stopping session.')
			stopSession()
		} else {
			console.log('Starting session.')
			startSession()
		}
	}

	const handleMicToggleClick = async () => {
		if (isListening) {
			console.log('Stopping microphone.')
			stopRecording()
		} else {
			console.log('Starting microphone.')
			startRecording()
		}
	}

	return (
		<div className='relative size-full'>
			<Controls
				handleConnectClick={handleConnectClick}
				handleMicToggleClick={handleMicToggleClick}
				isConnected={isSessionActive}
				isListening={isListening}
			/>
			{/* {audioUrl && <audio controls src={audioUrl} />} */}
			<Logs messages={logs} />
		</div>
	)
}
