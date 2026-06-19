<script setup>
import { useTaskList } from '@/stores/taskList.ts';
import Task from './task.vue';

taskList = useCounterStore
const emptyProject = {
    "Name": "",
    "Description": "",
    "Tasks": {taskList},
    "Deadline": "",
    "Affiliation": ""
};

</script>