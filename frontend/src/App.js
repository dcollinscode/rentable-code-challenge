import React from 'react';
import './App.css';
import TenantList from './TenantList';

function App() {
  return (
    <div className="App">
      <header className="App-header-minimal">
        <h1>Property Management Dashboard</h1>
      </header>
      <main className="App-main">
        <TenantList />
      </main>
    </div>
  );
}

export default App; 