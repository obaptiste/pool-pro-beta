# PoolStatus AI - Technical Overview

## System Architecture
- **Frontend**: React 18 + Vite + Tailwind CSS
- **Intelligence**: Gemini 3.1 Pro (LSI Analysis) & Gemini 3 Flash (Voice Transcription)
- **State Management**: React Hooks + LocalStorage
- **Visualization**: Recharts (Trends) & Framer Motion (Animations)

## Key Features
- **LSI Saturation Analysis**: Real-time calculation of water balance using Langelier Saturation Index.
- **Voice Telemetry**: Multimodal transcription of pool readings and maintenance notes.
- **Metric-First Design**: All telemetry (kPa, °C, kg/g) follows metric standards.
- **Context-Aware AI**: Gemini analyzes historical maintenance notes to prevent redundant chemical dosing.
- **Dynamic Protocol Checklist**: AI generates a step-by-step maintenance checklist that can be executed directly into the app's task system.
- **Predictive Outcome**: AI predicts what the telemetry readings should look like after the recommended protocol is completed.
- **Google Maps Grounding**: Integrated supply store locator.

## Data Schema
- **Reading**: `chlorine`, `ph`, `alkalinity`, `temperature`, `differentialPressure` (kPa), `calciumHardness`, `cyanuricAcid`.
- **LSI Calculation**: `pH + TF + CF + AF - 12.1`.

## Maintenance Protocols
- **Execute Protocol**: Stages chemical adjustments based on AI recommendations.
- **History Tracking**: 7-day trend analysis for all telemetry points.
