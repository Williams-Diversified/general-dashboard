import { Route, Routes } from 'react-router-dom';
import Contracts from './pages/Contracts';
import Opportunities from './pages/Opportunities';
import Overview from './pages/Overview';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Overview />} />
      <Route path="/opportunities" element={<Opportunities />} />
      <Route path="/contracts" element={<Contracts />} />
    </Routes>
  );
}
