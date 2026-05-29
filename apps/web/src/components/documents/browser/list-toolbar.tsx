import {
  ArrowDownAZ,
  ArrowUpAZ,
  ArrowDown01,
  ArrowUp01,
  Calendar,
  Clock,
  Type,
  WholeWord,
  Text,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export type SortField =
  | 'name'
  | 'updatedAt'
  | 'createdAt'
  | 'wordCount'
  | 'charCount'
  | 'charCountNoSpaces'
export type SortDirection = 'asc' | 'desc'
export type CounterMetric = 'wordCount' | 'charCount' | 'charCountNoSpaces'

const SORT_LABELS: Record<SortField, string> = {
  name: 'Name',
  updatedAt: 'Updated',
  createdAt: 'Created',
  wordCount: 'Words',
  charCount: 'Chars',
  charCountNoSpaces: 'Chars (no spaces)',
}

const METRIC_LABELS: Record<CounterMetric, string> = {
  wordCount: 'Words',
  charCount: 'Characters',
  charCountNoSpaces: 'Chars (no spaces)',
}

const METRIC_ICONS: Record<CounterMetric, React.ReactNode> = {
  wordCount: <WholeWord className="size-4" />,
  charCount: <Type className="size-4" />,
  charCountNoSpaces: <Text className="size-4" />,
}

interface ListToolbarProps {
  sortField: SortField
  sortDirection: SortDirection
  onSortFieldChange: (field: SortField) => void
  onSortDirectionToggle: () => void
  counterMetric: CounterMetric
  onCounterMetricChange: (metric: CounterMetric) => void
}

export function ListToolbar({
  sortField,
  sortDirection,
  onSortFieldChange,
  onSortDirectionToggle,
  counterMetric,
  onCounterMetricChange,
}: ListToolbarProps) {
  const isAsc = sortDirection === 'asc'

  return (
    <div className="flex items-center gap-1 border-b px-3 py-1">
      <span className="text-muted-foreground text-xs mr-0.5">Sort by</span>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="xs" className="text-muted-foreground gap-1 font-normal">
              {SORT_LABELS[sortField]}
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="min-w-28 w-auto">
          {(Object.keys(SORT_LABELS) as SortField[]).map((field) => (
            <DropdownMenuItem
              key={field}
              onClick={() => onSortFieldChange(field)}
              className={field === sortField ? 'text-foreground font-medium' : ''}
            >
              {field === 'name' ? (
                <ArrowDownAZ className="size-4" />
              ) : field === 'updatedAt' ? (
                <Clock className="size-4" />
              ) : field === 'createdAt' ? (
                <Calendar className="size-4" />
              ) : (
                METRIC_ICONS[field as CounterMetric]
              )}
              {SORT_LABELS[field]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onSortDirectionToggle}
        aria-label={isAsc ? 'Sort ascending' : 'Sort descending'}
        className="text-muted-foreground"
      >
        {sortField === 'name' ? (
          isAsc ? (
            <ArrowDownAZ className="size-3.5" />
          ) : (
            <ArrowUpAZ className="size-3.5" />
          )
        ) : isAsc ? (
          <ArrowDown01 className="size-3.5" />
        ) : (
          <ArrowUp01 className="size-3.5" />
        )}
      </Button>

      <div className="ml-auto flex items-center gap-1">
        <span className="text-muted-foreground text-xs">Count by</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="xs" className="text-muted-foreground gap-1 font-normal">
                {METRIC_LABELS[counterMetric]}
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-28 w-auto">
            {(Object.keys(METRIC_LABELS) as CounterMetric[]).map((metric) => (
              <DropdownMenuItem
                key={metric}
                onClick={() => onCounterMetricChange(metric)}
                className={metric === counterMetric ? 'text-foreground font-medium' : ''}
              >
                {METRIC_ICONS[metric]}
                {METRIC_LABELS[metric]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
