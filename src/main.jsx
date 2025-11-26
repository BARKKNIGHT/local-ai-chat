import React from 'react'
import ReactDOM from 'react-dom/client'
// NOTE: For quick testing of the new Offline LMS + Tutor, we render OfflineLMS here.
// To switch back to the original App, re-enable the import below and replace <OfflineLMS /> with <App />.
// import App from './App.jsx'
import OfflineLMS from './OfflineLMS.jsx'
import './index.css'  // <--- THIS IS CRITICAL FOR TAILWIND

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <OfflineLMS />
  </React.StrictMode>,
)