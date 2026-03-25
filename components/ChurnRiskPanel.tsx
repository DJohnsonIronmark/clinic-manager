'use client';

interface ChurnRiskPanelProps {
  onClose: () => void;
  selectedClinicName?: string;
}

export default function ChurnRiskPanel({ onClose, selectedClinicName }: ChurnRiskPanelProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Churn Risk Analysis</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            ✕
          </button>
        </div>
        <p className="text-gray-600">
          {selectedClinicName
            ? `Churn risk analysis for ${selectedClinicName} coming soon.`
            : 'Select a clinic to view churn risk analysis.'}
        </p>
        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
