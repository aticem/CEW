import React from 'react';

export default function PunchDetailTable({
    punches,
    contractors,
    onToggleStatus,
    onDelete,
    onHighlight,
    selectedId
}) {
    return (
        <div className="w-full h-full bg-slate-900 border-l border-slate-700 flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-700 bg-slate-800 flex items-center justify-between">
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-white">Punch Details</h3>
                <span className="text-[10px] font-bold text-slate-500 uppercase">{punches.length} Items</span>
            </div>

            <div className="flex-1 overflow-y-auto">
                <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-10 bg-slate-800/95 backdrop-blur-sm border-b border-slate-700">
                        <tr>
                            <th className="px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-500">ID</th>
                            <th className="px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-500">Issue</th>
                            <th className="px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-500">Cont.</th>
                            <th className="px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-500">Status</th>
                            <th className="px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-500 text-right">Opt</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                        {punches.length === 0 ? (
                            <tr>
                                <td colSpan="5" className="px-3 py-8 text-center text-[10px] text-slate-600 italic">
                                    No punches matching filters
                                </td>
                            </tr>
                        ) : (
                            punches.map((p) => {
                                const contractor = contractors.find(c => c.id === p.contractorId);
                                const isSelected = selectedId === p.id;

                                return (
                                    <tr
                                        key={p.id}
                                        onClick={() => onHighlight(p.id)}
                                        className={`group transition-colors cursor-pointer ${isSelected ? 'bg-amber-400/10' : 'hover:bg-slate-800/50'}`}
                                    >
                                        <td className="px-3 py-2.5">
                                            <span className={`text-[10px] font-bold ${isSelected ? 'text-amber-400' : 'text-slate-400'}`}>
                                                #{p.punchNumber}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <div className="flex flex-col max-w-[120px]">
                                                <span className="text-[11px] font-bold text-slate-200 truncate" title={p.text}>
                                                    {p.text}
                                                </span>
                                                <span className="text-[9px] text-slate-500 truncate">
                                                    {p.discipline || 'Unassigned'}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2.5">
                                            {contractor ? (
                                                <div className="flex items-center gap-1.5">
                                                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: contractor.color }}></span>
                                                    <span className="text-[9px] font-bold text-slate-400 uppercase truncate max-w-[40px]">
                                                        {contractor.name}
                                                    </span>
                                                </div>
                                            ) : (
                                                <span className="text-[9px] text-slate-600">—</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onToggleStatus(p.id);
                                                }}
                                                className={`px-1.5 py-0.5 rounded-[2px] text-[8px] font-black uppercase tracking-wider border transition-all ${p.completed
                                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/20'
                                                    : 'bg-amber-500/10 border-amber-500/30 text-amber-500 hover:bg-amber-500/20'
                                                    }`}
                                            >
                                                {p.completed ? 'Closed' : 'Open'}
                                            </button>
                                        </td>
                                        <td className="px-3 py-2.5 text-right">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (window.confirm('Delete this punch?')) onDelete(p.id);
                                                }}
                                                className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-500 transition-opacity"
                                            >
                                                🗑️
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
